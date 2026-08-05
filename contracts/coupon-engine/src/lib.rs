#![no_std]
#![allow(deprecated)]
use soroban_sdk::{contract, contractimpl, contracttype, vec, Address, BytesN, Env, IntoVal, Symbol, Vec};
use nbbs_shared::{BondError, ReportStatus};
use nbbs_oracle_consumer::Report;

pub const FIXED_POINT: i128 = 10_000_000;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    PeriodInfo(u64, u32),
    PeriodCount(u64),
    AccruedCredits(u64, Address),
    BondProject(u64),
    Precision,
    BondIssuerAddress,
    OracleConsumerAddress,
    Nonce(Address),
}

#[derive(Clone)]
#[contracttype]
pub struct PeriodInfo {
    pub period_index: u32,
    pub start_time: u64,
    pub end_time: u64,
    pub total_credits_earned: i128,
    pub distributed: bool,
    pub report_id: u64,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct CouponResult {
    pub bond_id: u64,
    pub period_index: u32,
    pub total_credits: i128,
    pub holder_count: u32,
    pub credits_per_token: i128,
}

#[contract]
pub struct CouponEngine;

#[contractimpl]
impl CouponEngine {
    pub fn __constructor(
        env: Env,
        admin: Address,
        bond_issuer_address: Address,
        oracle_consumer_address: Address,
    ) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::BondIssuerAddress, &bond_issuer_address);
        env.storage()
            .instance()
            .set(&DataKey::OracleConsumerAddress, &oracle_consumer_address);
        env.storage().instance().set(&DataKey::Precision, &FIXED_POINT);
    }

    pub fn register_bond(
        env: Env,
        caller: Address,
        bond_id: u64,
        project_id: BytesN<32>,
        nonce: u64,
    ) -> Result<(), BondError> {
        caller.require_auth();

        let expected_nonce = get_nonce(&env, &caller);
        if nonce != expected_nonce {
            return Err(BondError::InvalidNonce);
        }
        set_nonce(&env, &caller, expected_nonce + 1);

        require_admin(&env, &caller)?;

        env.storage()
            .instance()
            .set(&DataKey::BondProject(bond_id), &project_id);

        env.events().publish(
            (Symbol::new(&env, "bond_registered"),),
            (bond_id, project_id),
        );

        Ok(())
    }

    pub fn distribute_coupon(
        env: Env,
        caller: Address,
        bond_id: u64,
        period_index: u32,
        holders: Vec<Address>,
        report_id: u64,
        nonce: u64,
    ) -> Result<CouponResult, BondError> {
        caller.require_auth();

        let expected_nonce = get_nonce(&env, &caller);
        if nonce != expected_nonce {
            return Err(BondError::InvalidNonce);
        }
        set_nonce(&env, &caller, expected_nonce + 1);

        require_admin(&env, &caller)?;

        let project_id: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::BondProject(bond_id))
            .ok_or(BondError::BondNotFound)?;

        let oracle_consumer: Address = env
            .storage()
            .instance()
            .get(&DataKey::OracleConsumerAddress)
            .ok_or(BondError::NotInitialized)?;

        let report: Report = env.invoke_contract(
            &oracle_consumer,
            &Symbol::new(&env, "get_report"),
            vec![&env, report_id.into_val(&env)],
        );

        if report.status != ReportStatus::Verified {
            return Err(BondError::ReportNotVerified);
        }
        if report.project_id != project_id {
            return Err(BondError::BondNotFound);
        }

        let existing: Option<PeriodInfo> = env
            .storage()
            .persistent()
            .get(&DataKey::PeriodInfo(bond_id, period_index));
        if let Some(info) = existing {
            if info.distributed {
                return Err(BondError::Overflow);
            }
        }

        let total_credits = report.carbon_sequestered / 1000;

        let bond_issuer: Address = env
            .storage()
            .instance()
            .get(&DataKey::BondIssuerAddress)
            .expect("bond issuer not set");

        let total_subscribed: i128 = env.invoke_contract(
            &bond_issuer,
            &Symbol::new(&env, "total_subscribed"),
            vec![&env, bond_id.into_val(&env)],
        );

        let mut total_holder_credits: i128 = 0;
        let mut holder_count: u32 = 0;

        let credits_per_token = if total_subscribed > 0 && total_credits > 0 {
            total_credits * FIXED_POINT / total_subscribed
        } else {
            0
        };

        for holder in holders.iter() {
            let balance: i128 = env.invoke_contract(
                &bond_issuer,
                &Symbol::new(&env, "get_holder_balance"),
                vec![&env, bond_id.into_val(&env), holder.clone().into_val(&env)],
            );

            if balance > 0 {
                let holder_credits = credits_per_token * balance / FIXED_POINT;
                if holder_credits > 0 {
                    total_holder_credits = total_holder_credits
                        .checked_add(holder_credits)
                        .ok_or(BondError::Overflow)?;

                    let key = DataKey::AccruedCredits(bond_id, holder.clone());
                    let accrued: i128 = env.storage().persistent().get(&key).unwrap_or(0);
                    env.storage()
                        .persistent()
                        .set(&key, &(accrued + holder_credits));
                    holder_count += 1;
                }
            }
        }

        let period_info = PeriodInfo {
            period_index,
            start_time: report.period_start,
            end_time: report.period_end,
            total_credits_earned: total_holder_credits,
            distributed: true,
            report_id,
        };
        env.storage()
            .persistent()
            .set(&DataKey::PeriodInfo(bond_id, period_index), &period_info);

        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PeriodCount(bond_id))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::PeriodCount(bond_id), &(count + 1));

        env.events().publish(
            (Symbol::new(&env, "coupon_distributed"),),
            (bond_id, period_index, total_holder_credits, holder_count),
        );

        Ok(CouponResult {
            bond_id,
            period_index,
            total_credits: total_holder_credits,
            holder_count,
            credits_per_token,
        })
    }

    pub fn accrued_credits(env: Env, bond_id: u64, holder: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::AccruedCredits(bond_id, holder))
            .unwrap_or(0)
    }

    pub fn claim_credits(
        env: Env,
        caller: Address,
        bond_id: u64,
        nonce: u64,
    ) -> Result<i128, BondError> {
        caller.require_auth();

        let expected_nonce = get_nonce(&env, &caller);
        if nonce != expected_nonce {
            return Err(BondError::InvalidNonce);
        }
        set_nonce(&env, &caller, expected_nonce + 1);

        let key = DataKey::AccruedCredits(bond_id, caller.clone());
        let accrued: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &0i128);

        env.events().publish(
            (Symbol::new(&env, "credits_claimed"),),
            (bond_id, caller, accrued),
        );

        Ok(accrued)
    }

    pub fn get_period_info(
        env: Env,
        bond_id: u64,
        period_index: u32,
    ) -> Result<PeriodInfo, BondError> {
        env.storage()
            .persistent()
            .get(&DataKey::PeriodInfo(bond_id, period_index))
            .ok_or(BondError::BondNotFound)
    }

    pub fn get_period_count(env: Env, bond_id: u64) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PeriodCount(bond_id))
            .unwrap_or(0)
    }
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), BondError> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(BondError::NotInitialized)?;
    if caller != &admin {
        return Err(BondError::Unauthorized);
    }
    Ok(())
}

fn get_nonce(env: &Env, addr: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::Nonce(addr.clone()))
        .unwrap_or(0)
}

fn set_nonce(env: &Env, addr: &Address, nonce: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::Nonce(addr.clone()), &nonce);
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _, vec, BytesN, Env, Symbol,
    };

    fn create_project_id(env: &Env, value: u8) -> BytesN<32> {
        let mut arr = [0u8; 32];
        arr[31] = value;
        BytesN::from_array(env, &arr)
    }

    fn make_ipfs_hash(env: &Env, value: u8) -> BytesN<32> {
        let mut arr = [0u8; 32];
        arr[0] = value;
        BytesN::from_array(env, &arr)
    }

    fn make_bond_config(env: &Env, project_id: &BytesN<32>) -> nbbs_shared::BondConfig {
        nbbs_shared::BondConfig {
            project_id: project_id.clone(),
            face_value: 1000,
            coupon_schedule: vec![env, 1_000_000u64, 2_000_000u64],
            credit_type: nbbs_shared::CreditType::Carbon,
            maturity_date: 3_000_000,
            total_supply: 10_000,
        }
    }

    struct TestEnv {
        _env: Env,
        admin: Address,
        issuer_id: Address,
        issuer_admin: Address,
        oracle_id: Address,
        client: CouponEngineClient<'static>,
    }

    fn deploy(env: Env, admin: Address) -> TestEnv {
        let issuer_admin = Address::generate(&env);
        let issuer_id = env.register(
            nbbs_bond_issuer::BondIssuer,
            (issuer_admin.clone(),),
        );
        let oracle_id = env.register(
            nbbs_oracle_consumer::OracleConsumer,
            (admin.clone(),),
        );
        let ce_id = env.register(
            CouponEngine,
            (admin.clone(), issuer_id.clone(), oracle_id.clone()),
        );
        let client = CouponEngineClient::new(&env, &ce_id);

        TestEnv {
            _env: env,
            admin,
            issuer_id,
            issuer_admin,
            oracle_id,
            client,
        }
    }

    fn issue_and_subscribe(
        env: &Env,
        t: &TestEnv,
        project_id: &BytesN<32>,
        holder: &Address,
        amount: i128,
    ) -> u64 {
        let issuer = nbbs_bond_issuer::BondIssuerClient::new(env, &t.issuer_id);
        let config = make_bond_config(env, project_id);
        let bond_id = issuer.issue_bond(&t.issuer_admin, &config, &0);
        issuer.subscribe(holder, &bond_id, &amount, &0);
        bond_id
    }

    fn submit_verified_report(
        env: &Env,
        t: &TestEnv,
        project_id: &BytesN<32>,
        carbon: i128,
        admin_nonce: u64,
    ) -> u64 {
        let oc = nbbs_oracle_consumer::OracleConsumerClient::new(env, &t.oracle_id);
        let provider = Address::generate(env);
        oc.register_provider(&t.admin, &provider, &Symbol::new(env, "verra_vcs"), &admin_nonce);
        let report_id = oc.submit_report(
            &provider,
            project_id,
            &1000u64,
            &2000u64,
            &carbon,
            &Symbol::new(env, "verra_vcs"),
            &make_ipfs_hash(env, 1),
            &0,
        );
        oc.verify_report(&t.admin, &report_id, &(admin_nonce + 1));
        report_id
    }

    fn submit_unverified_report(
        env: &Env,
        t: &TestEnv,
        project_id: &BytesN<32>,
        carbon: i128,
        admin_nonce: u64,
    ) -> u64 {
        let oc = nbbs_oracle_consumer::OracleConsumerClient::new(env, &t.oracle_id);
        let provider = Address::generate(env);
        oc.register_provider(&t.admin, &provider, &Symbol::new(env, "verra_vcs"), &admin_nonce);
        oc.submit_report(
            &provider,
            project_id,
            &1000u64,
            &2000u64,
            &carbon,
            &Symbol::new(env, "verra_vcs"),
            &make_ipfs_hash(env, 1),
            &0,
        )
    }

    #[test]
    fn test_constructor_and_register_bond() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin.clone());

        let project_id = create_project_id(&t._env, 42);
        t.client.register_bond(&t.admin, &1, &project_id, &0);

        let count = t.client.get_period_count(&1);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_register_bond_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 42);
        let result = t.client.try_register_bond(&user, &1, &project_id, &0);
        assert_eq!(result, Err(Ok(BondError::Unauthorized)));
    }

    #[test]
    fn test_register_bond_invalid_nonce() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 42);
        let result = t.client.try_register_bond(&t.admin, &1, &project_id, &1);
        assert_eq!(result, Err(Ok(BondError::InvalidNonce)));
    }

    #[test]
    fn test_distribute_to_single_holder() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 1);
        let holder = Address::generate(&t._env);

        let bond_id = issue_and_subscribe(&t._env, &t, &project_id, &holder, 10_000);
        t.client.register_bond(&t.admin, &bond_id, &project_id, &0);

        let report_id = submit_verified_report(&t._env, &t, &project_id, 100_000, 0);
        let holders = vec![&t._env, holder.clone()];

        let result = t.client.distribute_coupon(
            &t.admin,
            &bond_id,
            &0,
            &holders,
            &report_id,
            &1,
        );

        assert_eq!(result.bond_id, bond_id);
        assert_eq!(result.period_index, 0);
        assert_eq!(result.total_credits, 100);
        assert_eq!(result.holder_count, 1);
        assert_eq!(result.credits_per_token, 100 * FIXED_POINT / 10000);

        let accrued = t.client.accrued_credits(&bond_id, &holder);
        assert_eq!(accrued, 100);

        let period_info = t.client.get_period_info(&bond_id, &0);
        assert!(period_info.distributed);
        assert_eq!(period_info.total_credits_earned, 100);
        assert_eq!(period_info.report_id, report_id);
    }

    #[test]
    fn test_distribute_pro_rata_multiple_holders() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 1);
        let holder1 = Address::generate(&t._env);
        let holder2 = Address::generate(&t._env);

        let bond_id = issue_and_subscribe(&t._env, &t, &project_id, &holder1, 3_000);
        let issuer = nbbs_bond_issuer::BondIssuerClient::new(&t._env, &t.issuer_id);
        issuer.subscribe(&holder2, &bond_id, &7_000, &0);

        t.client.register_bond(&t.admin, &bond_id, &project_id, &0);

        let report_id = submit_verified_report(&t._env, &t, &project_id, 100_000, 0);
        let holders = vec![&t._env, holder1.clone(), holder2.clone()];

        let result = t.client.distribute_coupon(
            &t.admin,
            &bond_id,
            &0,
            &holders,
            &report_id,
            &1,
        );

        assert_eq!(result.total_credits, 100);
        assert_eq!(result.holder_count, 2);

        let total_sub = 10000i128;
        let credits_per_token = 100 * FIXED_POINT / total_sub;
        let expected_h1 = credits_per_token * 3000 / FIXED_POINT;
        let expected_h2 = credits_per_token * 7000 / FIXED_POINT;

        assert_eq!(t.client.accrued_credits(&bond_id, &holder1), expected_h1);
        assert_eq!(t.client.accrued_credits(&bond_id, &holder2), expected_h2);
        assert_eq!(expected_h1 + expected_h2, 100);
    }

    #[test]
    fn test_distribute_zero_sequestration() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 1);
        let holder = Address::generate(&t._env);

        let bond_id = issue_and_subscribe(&t._env, &t, &project_id, &holder, 10_000);
        t.client.register_bond(&t.admin, &bond_id, &project_id, &0);

        let report_id = submit_verified_report(&t._env, &t, &project_id, 0, 0);
        let holders = vec![&t._env, holder.clone()];

        let result = t.client.distribute_coupon(
            &t.admin,
            &bond_id,
            &0,
            &holders,
            &report_id,
            &1,
        );

        assert_eq!(result.total_credits, 0);
        assert_eq!(result.holder_count, 0);
        assert_eq!(result.credits_per_token, 0);

        let accrued = t.client.accrued_credits(&bond_id, &holder);
        assert_eq!(accrued, 0);
    }

    #[test]
    fn test_distribute_rejects_unverified_report() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 1);
        let holder = Address::generate(&t._env);

        let bond_id = issue_and_subscribe(&t._env, &t, &project_id, &holder, 10_000);
        t.client.register_bond(&t.admin, &bond_id, &project_id, &0);

        let report_id = submit_unverified_report(&t._env, &t, &project_id, 100_000, 0);
        let holders = vec![&t._env, holder.clone()];

        let result = t.client.try_distribute_coupon(
            &t.admin,
            &bond_id,
            &0,
            &holders,
            &report_id,
            &1,
        );
        assert_eq!(result, Err(Ok(BondError::ReportNotVerified)));

        let accrued = t.client.accrued_credits(&bond_id, &holder);
        assert_eq!(accrued, 0);
    }

    #[test]
    fn test_distribute_rejects_report_for_other_project() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 1);
        let other_project = create_project_id(&t._env, 2);
        let holder = Address::generate(&t._env);

        let bond_id = issue_and_subscribe(&t._env, &t, &project_id, &holder, 10_000);
        t.client.register_bond(&t.admin, &bond_id, &project_id, &0);

        let report_id = submit_verified_report(&t._env, &t, &other_project, 100_000, 0);
        let holders = vec![&t._env, holder.clone()];

        let result = t.client.try_distribute_coupon(
            &t.admin,
            &bond_id,
            &0,
            &holders,
            &report_id,
            &1,
        );
        assert_eq!(result, Err(Ok(BondError::BondNotFound)));
    }

    #[test]
    fn test_prevent_double_distribute() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 1);
        let holder = Address::generate(&t._env);

        let bond_id = issue_and_subscribe(&t._env, &t, &project_id, &holder, 10_000);
        t.client.register_bond(&t.admin, &bond_id, &project_id, &0);

        let report_id = submit_verified_report(&t._env, &t, &project_id, 100_000, 0);
        let holders = vec![&t._env, holder.clone()];

        t.client.distribute_coupon(&t.admin, &bond_id, &0, &holders, &report_id, &1);

        let result = t.client.try_distribute_coupon(
            &t.admin,
            &bond_id,
            &0,
            &holders,
            &report_id,
            &2,
        );
        assert_eq!(result, Err(Ok(BondError::Overflow)));
    }

    #[test]
    fn test_distribute_unregistered_bond() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 1);
        let report_id = submit_verified_report(&t._env, &t, &project_id, 100_000, 0);
        let holders = vec![&t._env];

        let result = t.client.try_distribute_coupon(
            &t.admin,
            &999,
            &0,
            &holders,
            &report_id,
            &0,
        );
        assert_eq!(result, Err(Ok(BondError::BondNotFound)));
    }

    #[test]
    fn test_claim_credits() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 1);
        let holder = Address::generate(&t._env);

        let bond_id = issue_and_subscribe(&t._env, &t, &project_id, &holder, 10_000);
        t.client.register_bond(&t.admin, &bond_id, &project_id, &0);

        let report_id = submit_verified_report(&t._env, &t, &project_id, 100_000, 0);
        let holders = vec![&t._env, holder.clone()];
        t.client.distribute_coupon(&t.admin, &bond_id, &0, &holders, &report_id, &1);

        let claimed = t.client.claim_credits(&holder, &bond_id, &0);
        assert_eq!(claimed, 100);

        let accrued = t.client.accrued_credits(&bond_id, &holder);
        assert_eq!(accrued, 0);
    }

    #[test]
    fn test_zero_holders_case() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 1);
        let holder = Address::generate(&t._env);

        let bond_id = issue_and_subscribe(&t._env, &t, &project_id, &holder, 10_000);
        t.client.register_bond(&t.admin, &bond_id, &project_id, &0);

        let report_id = submit_verified_report(&t._env, &t, &project_id, 100_000, 0);
        let holders = vec![&t._env];

        let result = t.client.distribute_coupon(
            &t.admin,
            &bond_id,
            &0,
            &holders,
            &report_id,
            &1,
        );

        assert_eq!(result.total_credits, 0);
        assert_eq!(result.holder_count, 0);
        assert!(result.credits_per_token >= 0);

        let period_info = t.client.get_period_info(&bond_id, &0);
        assert!(period_info.distributed);
    }

    #[test]
    fn test_period_count_increments() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let t = deploy(env, admin);

        let project_id = create_project_id(&t._env, 1);
        let holder = Address::generate(&t._env);

        let bond_id = issue_and_subscribe(&t._env, &t, &project_id, &holder, 10_000);
        t.client.register_bond(&t.admin, &bond_id, &project_id, &0);

        assert_eq!(t.client.get_period_count(&bond_id), 0);

        let report_id = submit_verified_report(&t._env, &t, &project_id, 100_000, 0);
        let holders = vec![&t._env, holder.clone()];

        t.client.distribute_coupon(&t.admin, &bond_id, &0, &holders, &report_id, &1);
        assert_eq!(t.client.get_period_count(&bond_id), 1);

        let report_id2 = submit_verified_report(&t._env, &t, &project_id, 200_000, 2);
        t.client.distribute_coupon(&t.admin, &bond_id, &1, &holders, &report_id2, &2);
        assert_eq!(t.client.get_period_count(&bond_id), 2);
    }

    #[test]
    fn test_query_accrued_credits_zero() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let issuer = Address::generate(&env);
        let oracle = Address::generate(&env);

        let contract_id = env.register(CouponEngine, (admin, issuer, oracle));
        let client = CouponEngineClient::new(&env, &contract_id);

        let holder = Address::generate(&env);
        let accrued = client.accrued_credits(&1, &holder);
        assert_eq!(accrued, 0);
    }

    #[test]
    fn test_claim_credits_invalid_nonce() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let issuer = Address::generate(&env);
        let oracle = Address::generate(&env);

        let contract_id = env.register(CouponEngine, (admin, issuer, oracle));
        let client = CouponEngineClient::new(&env, &contract_id);

        let holder = Address::generate(&env);
        let result = client.try_claim_credits(&holder, &1, &1);
        assert_eq!(result, Err(Ok(BondError::InvalidNonce)));
    }
}
