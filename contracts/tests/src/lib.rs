#[cfg(test)]
mod integration {
    use soroban_sdk::{
        testutils::Address as _, testutils::Ledger as _, Address, BytesN, Env, IntoVal, Symbol, Val,
    };
    use nbbs_project_registry::{ProjectRegistry, ProjectRegistryClient};
    use nbbs_bond_issuer::{BondIssuer, BondIssuerClient};
    use nbbs_coupon_engine::{CouponEngine, CouponEngineClient};
    use nbbs_oracle_consumer::{OracleConsumer, OracleConsumerClient};
    use nbbs_dex_router::{DEXRouter, DEXRouterClient, OrderStatus};
    use nbbs_credit_retirement::{CreditRetirement, CreditRetirementClient};
    use nbbs_shared::{
        BondConfig, BondError, BondStatus, CreditType, DEXError, GovernanceError, OracleError,
        ProjectStatus, RegistryError, ReportStatus,
    };

    fn make_project_id(env: &Env, value: u8) -> BytesN<32> {
        let mut arr = [0u8; 32];
        arr[31] = value;
        BytesN::from_array(env, &arr)
    }

    fn make_ipfs_hash(env: &Env, value: u8) -> BytesN<32> {
        let mut arr = [0u8; 32];
        arr[0] = value;
        BytesN::from_array(env, &arr)
    }

    fn make_bond_config(
        env: &Env,
        project_id: BytesN<32>,
        total_supply: i128,
    ) -> BondConfig {
        BondConfig {
            project_id,
            face_value: 1000,
            coupon_schedule: soroban_sdk::vec![env, 1_000_000u64, 2_000_000u64],
            credit_type: CreditType::Carbon,
            maturity_date: 3_000_000,
            total_supply,
        }
    }

    struct TestContracts<'a> {
        pr_client: ProjectRegistryClient<'a>,
        bi_client: BondIssuerClient<'a>,
        ce_client: CouponEngineClient<'a>,
        oc_client: OracleConsumerClient<'a>,
        dr_client: DEXRouterClient<'a>,
        cr_client: CreditRetirementClient<'a>,
    }

    fn deploy_contracts<'a>(env: &'a Env, admin: &Address) -> TestContracts<'a> {
        let pr_addr = env.register(ProjectRegistry, (admin.clone(),));
        let pr_client = ProjectRegistryClient::new(env, &pr_addr);

        let bi_addr = env.register(BondIssuer, (admin.clone(),));
        let bi_client = BondIssuerClient::new(env, &bi_addr);

        let oc_addr = env.register(OracleConsumer, (admin.clone(),));
        let oc_client = OracleConsumerClient::new(env, &oc_addr);

        let ce_addr = env.register(
            CouponEngine,
            (admin.clone(), bi_addr.clone(), oc_addr.clone()),
        );
        let ce_client = CouponEngineClient::new(env, &ce_addr);

        let dr_addr = env.register(
            DEXRouter,
            (admin.clone(), bi_addr.clone(), ce_addr.clone()),
        );
        let dr_client = DEXRouterClient::new(env, &dr_addr);

        let cr_addr = env.register(
            CreditRetirement,
            (admin.clone(), bi_addr.clone(), ce_addr.clone()),
        );
        let cr_client = CreditRetirementClient::new(env, &cr_addr);

        TestContracts {
            pr_client,
            bi_client,
            ce_client,
            oc_client,
            dr_client,
            cr_client,
        }
    }

    mod full_lifecycle {
        use super::*;

        #[test]
        fn test_happy_path() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let oracle = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            assert_eq!(pid, 1);

            contracts.pr_client.approve_project(&admin, &pid, &0);

            let project = contracts.pr_client.get_project(&pid);
            assert_eq!(project.status, ProjectStatus::Approved);

            let config = make_bond_config(&env, project_id.clone(), 10_000);
            let bond_id = contracts.bi_client.issue_bond(&admin, &config, &0);
            assert_eq!(bond_id, 1);

            contracts.bi_client.subscribe(&bob, &bond_id, &1_000, &0);
            let balance = contracts.bi_client.get_holder_balance(&bond_id, &bob);
            assert_eq!(balance, 1_000);

            contracts.oc_client.register_provider(
                &admin,
                &oracle,
                &Symbol::new(&env, "verra_vcs"),
                &0,
            );

            let report_id = contracts.oc_client.submit_report(
                &oracle,
                &project_id,
                &1000u64,
                &2000u64,
                &100_000i128,
                &Symbol::new(&env, "verra_vcs"),
                &make_ipfs_hash(&env, 1),
                &0,
            );
            assert_eq!(report_id, 1);

            contracts.oc_client.verify_report(&admin, &report_id, &1);

            let report = contracts.oc_client.get_report(&report_id);
            assert_eq!(report.status, ReportStatus::Verified);

            contracts.ce_client.register_bond(&admin, &bond_id, &project_id, &0);

            let holders = soroban_sdk::vec![&env, bob.clone()];
            let result = contracts.ce_client.distribute_coupon(
                &admin,
                &bond_id,
                &0,
                &holders,
                &report_id,
                &1,
            );
            assert!(result.total_credits > 0);
            assert_eq!(result.holder_count, 1);

            let accrued = contracts.ce_client.accrued_credits(&bond_id, &bob);
            assert!(accrued > 0);

            let credit_hash = make_ipfs_hash(&env, 42);
            let retirement_id = contracts.cr_client.retire_credits(
                &bob,
                &bond_id,
                &accrued,
                &CreditType::Carbon,
                &credit_hash,
                &0,
            );
            assert_eq!(retirement_id, 1);

            let record = contracts.cr_client.get_retirement_record(&retirement_id);
            assert_eq!(record.holder, bob);
            assert_eq!(record.amount, accrued);
            assert_eq!(record.credit_type, CreditType::Carbon);
            assert_eq!(record.certificate_ipfs_hash, credit_hash);

            let total_retired = contracts.cr_client.get_total_retired(&bob);
            assert_eq!(total_retired, accrued);

            assert_eq!(contracts.cr_client.total_retirements(), 1);
        }

        #[test]
        fn test_insufficient_supply() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            let config = make_bond_config(&env, project_id, 1_000);
            let bond_id = contracts.bi_client.issue_bond(&admin, &config, &0);

            contracts.bi_client.subscribe(&alice, &bond_id, &1_000, &0);

            let result = contracts
                .bi_client
                .try_subscribe(&bob, &bond_id, &1, &0);
            assert_eq!(result, Err(Ok(BondError::InsufficientSupply)));
        }

        #[test]
        fn test_coupon_requires_verified_report() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let oracle = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            let config = make_bond_config(&env, project_id.clone(), 10_000);
            let bond_id = contracts.bi_client.issue_bond(&admin, &config, &0);
            contracts.bi_client.subscribe(&bob, &bond_id, &1_000, &0);

            contracts.oc_client.register_provider(
                &admin,
                &oracle,
                &Symbol::new(&env, "verra_vcs"),
                &0,
            );

            let report_id = contracts.oc_client.submit_report(
                &oracle,
                &project_id,
                &1000u64,
                &2000u64,
                &100_000i128,
                &Symbol::new(&env, "verra_vcs"),
                &make_ipfs_hash(&env, 1),
                &0,
            );

            contracts.ce_client.register_bond(&admin, &bond_id, &project_id, &0);

            let holders = soroban_sdk::vec![&env, bob.clone()];

            let rejected = contracts.ce_client.try_distribute_coupon(
                &admin,
                &bond_id,
                &0,
                &holders,
                &report_id,
                &1,
            );
            assert_eq!(rejected, Err(Ok(BondError::ReportNotVerified)));

            contracts.oc_client.verify_report(&admin, &report_id, &1);

            let result = contracts.ce_client.distribute_coupon(
                &admin,
                &bond_id,
                &0,
                &holders,
                &report_id,
                &1,
            );
            assert!(result.total_credits > 0);
        }
    }

    mod oracle {
        use super::*;

        #[test]
        fn test_challenge_flow() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let oracle = Address::generate(&env);
            let challenger = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            contracts.oc_client.register_provider(
                &admin,
                &oracle,
                &Symbol::new(&env, "verra_vcs"),
                &0,
            );

            let report_id = contracts.oc_client.submit_report(
                &oracle,
                &project_id,
                &1000u64,
                &2000u64,
                &100_000i128,
                &Symbol::new(&env, "verra_vcs"),
                &make_ipfs_hash(&env, 1),
                &0,
            );

            contracts.oc_client.challenge_report(
                &challenger,
                &report_id,
                &make_ipfs_hash(&env, 2),
                &0,
            );

            let report = contracts.oc_client.get_report(&report_id);
            assert_eq!(report.status, ReportStatus::Challenged);

            contracts.oc_client.resolve_challenge(
                &admin,
                &report_id,
                &ReportStatus::Rejected,
                &1,
            );

            let resolved = contracts.oc_client.get_report(&report_id);
            assert_eq!(resolved.status, ReportStatus::Rejected);
        }

        #[test]
        fn test_multi_source_threshold() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let oracle_a = Address::generate(&env);
            let oracle_b = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            contracts.oc_client.set_signature_threshold(&admin, &2u32, &0);
            contracts.oc_client.register_provider(
                &admin,
                &oracle_a,
                &Symbol::new(&env, "verra_vcs"),
                &1,
            );
            contracts.oc_client.register_provider(
                &admin,
                &oracle_b,
                &Symbol::new(&env, "verra_vcs"),
                &2,
            );

            let report_id = contracts.oc_client.submit_report(
                &oracle_a,
                &project_id,
                &1000u64,
                &2000u64,
                &100_000i128,
                &Symbol::new(&env, "verra_vcs"),
                &make_ipfs_hash(&env, 1),
                &0,
            );

            let self_result = contracts
                .oc_client
                .try_verify_report(&oracle_a, &report_id, &1);
            assert_eq!(self_result, Err(Ok(OracleError::InvalidSignature)));

            contracts.oc_client.verify_report(&admin, &report_id, &3);

            let pending = contracts.oc_client.get_report(&report_id);
            assert_eq!(pending.status, ReportStatus::Pending);
            assert_eq!(contracts.oc_client.get_verification_count(&report_id), 1);

            contracts.oc_client.verify_report(&oracle_b, &report_id, &0);

            let verified = contracts.oc_client.get_report(&report_id);
            assert_eq!(verified.status, ReportStatus::Verified);
            assert_eq!(contracts.oc_client.get_verification_count(&report_id), 2);
        }

        #[test]
        fn test_rejected_challenge_slashes_provider() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let oracle = Address::generate(&env);
            let challenger = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            contracts.oc_client.register_provider(
                &admin,
                &oracle,
                &Symbol::new(&env, "verra_vcs"),
                &0,
            );
            contracts.oc_client.add_stake(&oracle, &100_000i128, &0);

            let report_id = contracts.oc_client.submit_report(
                &oracle,
                &project_id,
                &1000u64,
                &2000u64,
                &100_000i128,
                &Symbol::new(&env, "verra_vcs"),
                &make_ipfs_hash(&env, 1),
                &1,
            );

            contracts.oc_client.challenge_report(
                &challenger,
                &report_id,
                &make_ipfs_hash(&env, 2),
                &0,
            );

            contracts.oc_client.resolve_challenge(
                &admin,
                &report_id,
                &ReportStatus::Rejected,
                &1,
            );

            let provider = contracts.oc_client.get_provider(&oracle);
            assert_eq!(provider.stake, 90_000);
            assert!(provider.active);

            let report = contracts.oc_client.get_report(&report_id);
            assert_eq!(report.status, ReportStatus::Rejected);
        }
    }

    mod dex {
        use super::*;

        #[test]
        fn test_full_settlement_with_seller_withdrawal() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            let config = make_bond_config(&env, project_id, 10_000);
            let bond_id = contracts.bi_client.issue_bond(&admin, &config, &0);
            contracts.bi_client.subscribe(&alice, &bond_id, &5_000, &0);

            let order_id = contracts.dr_client.list_bond_tokens(
                &alice,
                &bond_id,
                &1_000i128,
                &100i128,
                &Symbol::new(&env, "USDC"),
                &3600u64,
                &0,
            );

            contracts
                .dr_client
                .deposit_quote(&bob, &Symbol::new(&env, "USDC"), &100_000i128, &0);

            contracts
                .dr_client
                .execute_purchase(&bob, &order_id, &100i128, &1_000i128, &1);

            let order = contracts.dr_client.get_order(&order_id);
            assert_eq!(order.status, nbbs_dex_router::OrderStatus::Filled);

            assert_eq!(
                contracts
                    .dr_client
                    .get_quote_balance(&alice, &Symbol::new(&env, "USDC")),
                100_000
            );
            assert_eq!(
                contracts
                    .dr_client
                    .get_quote_balance(&bob, &Symbol::new(&env, "USDC")),
                0
            );

            contracts
                .dr_client
                .withdraw_quote(&alice, &Symbol::new(&env, "USDC"), &100_000i128, &1);

            assert_eq!(
                contracts
                    .dr_client
                    .get_quote_balance(&alice, &Symbol::new(&env, "USDC")),
                0
            );
        }

        #[test]
        fn test_order_full_fill() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            let config = make_bond_config(&env, project_id, 10_000);
            let bond_id = contracts.bi_client.issue_bond(&admin, &config, &0);
            contracts.bi_client.subscribe(&alice, &bond_id, &5_000, &0);

            let order_id = contracts.dr_client.list_bond_tokens(
                &alice,
                &bond_id,
                &1_000i128,
                &100i128,
                &Symbol::new(&env, "USDC"),
                &3600u64,
                &0,
            );
            assert_eq!(order_id, 1);

            contracts
                .dr_client
                .deposit_quote(&bob, &Symbol::new(&env, "USDC"), &100_000i128, &0);

            contracts
                .dr_client
                .execute_purchase(&bob, &order_id, &100i128, &1_000i128, &1);

            let order = contracts.dr_client.get_order(&order_id);
            assert_eq!(order.status, nbbs_dex_router::OrderStatus::Filled);
        }

        #[test]
        fn test_order_partial_fill() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            let config = make_bond_config(&env, project_id, 10_000);
            let bond_id = contracts.bi_client.issue_bond(&admin, &config, &0);
            contracts.bi_client.subscribe(&alice, &bond_id, &5_000, &0);

            let order_id = contracts.dr_client.list_bond_tokens(
                &alice,
                &bond_id,
                &1_000i128,
                &100i128,
                &Symbol::new(&env, "USDC"),
                &3600u64,
                &0,
            );

            contracts
                .dr_client
                .deposit_quote(&bob, &Symbol::new(&env, "USDC"), &100_000i128, &0);

            contracts
                .dr_client
                .execute_purchase(&bob, &order_id, &100i128, &400i128, &1);

            let order = contracts.dr_client.get_order(&order_id);
            assert_eq!(order.status, nbbs_dex_router::OrderStatus::PartiallyFilled);
            assert_eq!(order.amount, 600);

            contracts
                .dr_client
                .execute_purchase(&bob, &order_id, &100i128, &600i128, &2);

            let order = contracts.dr_client.get_order(&order_id);
            assert_eq!(order.status, nbbs_dex_router::OrderStatus::Filled);
        }

        #[test]
        fn test_order_settles_bond_tokens() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            let config = make_bond_config(&env, project_id, 10_000);
            let bond_id = contracts.bi_client.issue_bond(&admin, &config, &0);
            contracts.bi_client.subscribe(&alice, &bond_id, &5_000, &0);

            let order_id = contracts.dr_client.list_bond_tokens(
                &alice,
                &bond_id,
                &1_000i128,
                &100i128,
                &Symbol::new(&env, "USDC"),
                &3600u64,
                &0,
            );

            contracts
                .dr_client
                .deposit_quote(&bob, &Symbol::new(&env, "USDC"), &100_000i128, &0);

            contracts
                .dr_client
                .execute_purchase(&bob, &order_id, &100i128, &1_000i128, &1);

            let order = contracts.dr_client.get_order(&order_id);
            assert_eq!(order.status, nbbs_dex_router::OrderStatus::Filled);

            let alice_balance =
                contracts.bi_client.get_holder_balance(&bond_id, &alice);
            let bob_balance = contracts.bi_client.get_holder_balance(&bond_id, &bob);
            assert_eq!(alice_balance, 4_000);
            assert_eq!(bob_balance, 1_000);

            assert_eq!(
                contracts.dr_client.get_quote_balance(
                    &alice,
                    &Symbol::new(&env, "USDC")
                ),
                100_000
            );
            assert_eq!(
                contracts
                    .dr_client
                    .get_quote_balance(&bob, &Symbol::new(&env, "USDC")),
                0
            );
        }
    }

    mod security {
        use super::*;

        #[test]
        fn test_time_based_maturity_and_redeem() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            let config = make_bond_config(&env, project_id, 10_000);
            let bond_id = contracts.bi_client.issue_bond(&admin, &config, &0);
            contracts.bi_client.subscribe(&alice, &bond_id, &2_000, &0);

            env.ledger().set_timestamp(config.maturity_date - 1);
            let early = contracts
                .bi_client
                .try_mature_bond(&admin, &bond_id, &1);
            assert_eq!(early, Err(Ok(BondError::Overflow)));

            env.ledger().set_timestamp(config.maturity_date);
            contracts.bi_client.mature_bond(&admin, &bond_id, &1);

            let state = contracts.bi_client.get_bond_state(&bond_id);
            assert_eq!(state.status, nbbs_shared::BondStatus::Matured);

            contracts.bi_client.redeem(&alice, &bond_id, &2_000, &1);
            assert_eq!(contracts.bi_client.get_holder_balance(&bond_id, &alice), 0);
        }

        #[test]
        fn test_coupon_dust_reconciliation() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let carol = Address::generate(&env);
            let oracle = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            let config = make_bond_config(&env, project_id.clone(), 10_000);
            let bond_id = contracts.bi_client.issue_bond(&admin, &config, &0);

            contracts.bi_client.subscribe(&alice, &bond_id, &1, &0);
            contracts.bi_client.subscribe(&bob, &bond_id, &1, &0);
            contracts.bi_client.subscribe(&carol, &bond_id, &1, &0);

            contracts.oc_client.register_provider(
                &admin,
                &oracle,
                &Symbol::new(&env, "verra_vcs"),
                &0,
            );

            let report_id = contracts.oc_client.submit_report(
                &oracle,
                &project_id,
                &1000u64,
                &2000u64,
                &100_000i128,
                &Symbol::new(&env, "verra_vcs"),
                &make_ipfs_hash(&env, 1),
                &0,
            );
            contracts.oc_client.verify_report(&admin, &report_id, &1);

            contracts.ce_client.register_bond(&admin, &bond_id, &project_id, &0);

            let holders = soroban_sdk::vec![
                &env,
                alice.clone(),
                bob.clone(),
                carol.clone(),
            ];
            let result = contracts.ce_client.distribute_coupon(
                &admin,
                &bond_id,
                &0,
                &holders,
                &report_id,
                &1,
            );

            assert_eq!(result.total_credits, 99);
            assert_eq!(result.holder_count, 3);

            assert_eq!(contracts.ce_client.get_undistributed_total(&bond_id), 1);

            let swept = contracts.ce_client.sweep_undistributed(&admin, &bond_id, &2);
            assert_eq!(swept, 1);
            assert_eq!(contracts.ce_client.get_undistributed_total(&bond_id), 0);
        }

        #[test]
        fn test_nonce_replay() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );

            let result = contracts.pr_client.try_register_project(
                &alice,
                &make_ipfs_hash(&env, 2),
                &Symbol::new(&env, "GS"),
                &Symbol::new(&env, "BR"),
                &0,
            );
            assert_eq!(result, Err(Ok(RegistryError::InvalidNonce)));

            let id = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 2),
                &Symbol::new(&env, "GS"),
                &Symbol::new(&env, "BR"),
                &1,
            );
            assert_eq!(id, 2);
        }

        #[test]
        fn test_permission_checks() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let _oracle = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );

            let result = contracts
                .pr_client
                .try_approve_project(&bob, &pid, &0);
            assert_eq!(result, Err(Ok(RegistryError::Unauthorized)));

            let config = make_bond_config(&env, project_id.clone(), 10_000);
            let result = contracts.bi_client.try_issue_bond(&alice, &config, &0);
            assert_eq!(result, Err(Ok(BondError::Unauthorized)));

            let result = contracts.oc_client.try_submit_report(
                &bob,
                &project_id,
                &1000u64,
                &2000u64,
                &100_000i128,
                &Symbol::new(&env, "verra_vcs"),
                &make_ipfs_hash(&env, 1),
                &0,
            );
            assert_eq!(result, Err(Ok(OracleError::ProviderNotFound)));
        }

        #[test]
        fn test_unauthorized_oracle_operations() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let rogue = Address::generate(&env);
            let contracts = deploy_contracts(&env, &admin);

            let project_id = make_project_id(&env, 1);

            let pid = contracts.pr_client.register_project(
                &alice,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            contracts.pr_client.approve_project(&admin, &pid, &0);

            let result = contracts.oc_client.try_submit_report(
                &rogue,
                &project_id,
                &1000u64,
                &2000u64,
                &100_000i128,
                &Symbol::new(&env, "verra_vcs"),
                &make_ipfs_hash(&env, 1),
                &0,
            );
            assert_eq!(result, Err(Ok(OracleError::ProviderNotFound)));
        }
    }

    mod governance {
        use super::*;
        use nbbs_governance::{
            Governance, GovernanceClient, ProposalStatus,
        };

        const TIMELOCK: u64 = 172_800;

        struct Governed<'a> {
            gov_id: Address,
            gov: GovernanceClient<'a>,
            signers: soroban_sdk::Vec<Address>,
            pr_addr: Address,
            pr: ProjectRegistryClient<'a>,
            bi_addr: Address,
            bi: BondIssuerClient<'a>,
            oc_addr: Address,
            oc: OracleConsumerClient<'a>,
            ce_addr: Address,
            ce: CouponEngineClient<'a>,
            dr_addr: Address,
            dr: DEXRouterClient<'a>,
            cr_addr: Address,
            cr: CreditRetirementClient<'a>,
        }

        fn make_signers(env: &Env, count: u32) -> soroban_sdk::Vec<Address> {
            let mut signers = soroban_sdk::vec![env];
            for _ in 0..count {
                signers.push_back(Address::generate(env));
            }
            signers
        }

        fn deploy_governed<'a>(env: &'a Env) -> Governed<'a> {
            let signers = make_signers(env, 5);
            let threshold: u32 = 3;
            let gov_id = env.register(Governance, (&signers, &threshold, &TIMELOCK));
            let gov = GovernanceClient::new(env, &gov_id);

            let pr_addr = env.register(ProjectRegistry, (gov_id.clone(),));
            let pr = ProjectRegistryClient::new(env, &pr_addr);

            let bi_addr = env.register(BondIssuer, (gov_id.clone(),));
            let bi = BondIssuerClient::new(env, &bi_addr);

            let oc_addr = env.register(OracleConsumer, (gov_id.clone(),));
            let oc = OracleConsumerClient::new(env, &oc_addr);

            let ce_addr = env.register(
                CouponEngine,
                (gov_id.clone(), bi_addr.clone(), oc_addr.clone()),
            );
            let ce = CouponEngineClient::new(env, &ce_addr);

            let dr_addr = env.register(
                DEXRouter,
                (gov_id.clone(), bi_addr.clone(), ce_addr.clone()),
            );
            let dr = DEXRouterClient::new(env, &dr_addr);

            let cr_addr = env.register(
                CreditRetirement,
                (gov_id.clone(), bi_addr.clone(), ce_addr.clone()),
            );
            let cr = CreditRetirementClient::new(env, &cr_addr);

            Governed {
                gov_id,
                gov,
                signers,
                pr_addr,
                pr,
                bi_addr,
                bi,
                oc_addr,
                oc,
                ce_addr,
                ce,
                dr_addr,
                dr,
                cr_addr,
                cr,
            }
        }

        fn ratify_and_execute(
            env: &Env,
            gov: &GovernanceClient,
            signers: &soroban_sdk::Vec<Address>,
            nonces: &mut Vec<u64>,
            target: &Address,
            method: &Symbol,
            args: &soroban_sdk::Vec<Val>,
        ) -> u64 {
            let proposal_id = gov.propose(
                &signers.get(0).unwrap(),
                target,
                method,
                &args.clone(),
                &Symbol::new(env, "ratify"),
                &nonces[0],
            );
            nonces[0] += 1;

            gov.vote_approve(&signers.get(1).unwrap(), &proposal_id, &nonces[1]);
            nonces[1] += 1;
            gov.vote_approve(&signers.get(2).unwrap(), &proposal_id, &nonces[2]);
            nonces[2] += 1;
            gov.vote_approve(&signers.get(3).unwrap(), &proposal_id, &nonces[3]);
            nonces[3] += 1;

            env.ledger().set_timestamp(env.ledger().timestamp() + TIMELOCK);

            gov.execute(&signers.get(0).unwrap(), &proposal_id, &nonces[0]);
            nonces[0] += 1;

            proposal_id
        }

        #[test]
        fn test_ratified_parameter_change_takes_effect() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();
            env.ledger().set_timestamp(1_000_000);

            let governed = deploy_governed(&env);
            let mut nonces = vec![0u64; 5];

            assert_eq!(governed.oc.get_signature_threshold(), 1);

            let args = soroban_sdk::vec![&env, 3u32.into_val(&env)];
            let proposal_id = ratify_and_execute(
                &env,
                &governed.gov,
                &governed.signers,
                &mut nonces,
                &governed.oc_addr,
                &Symbol::new(&env, "set_signature_threshold"),
                &args,
            );

            assert_eq!(governed.oc.get_signature_threshold(), 3);
            assert_eq!(
                governed.gov.get_proposal(&proposal_id).status,
                ProposalStatus::Executed
            );
        }

        #[test]
        fn test_admin_functions_reject_direct_signer_calls() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let governed = deploy_governed(&env);
            let signer = governed.signers.get(0).unwrap();

            let result = governed
                .oc
                .try_set_signature_threshold(&signer, &5, &0);
            assert_eq!(result, Err(Ok(OracleError::Unauthorized)));

            let user = Address::generate(&env);
            let pid = governed.pr.register_project(
                &user,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            let result = governed.pr.try_approve_project(&signer, &pid, &0);
            assert_eq!(result, Err(Ok(RegistryError::Unauthorized)));

            let config = make_bond_config(&env, make_project_id(&env, 1), 10_000);
            let result = governed.bi.try_issue_bond(&signer, &config, &0);
            assert_eq!(result, Err(Ok(BondError::Unauthorized)));

            let result = governed.ce.try_register_bond(
                &signer,
                &1,
                &make_project_id(&env, 1),
                &0,
            );
            assert_eq!(result, Err(Ok(BondError::Unauthorized)));

            let result = governed.dr.try_clean_expired_orders(&signer, &0);
            assert_eq!(result, Err(Ok(DEXError::Unauthorized)));
        }

        #[test]
        fn test_timelock_blocks_early_execution() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();
            env.ledger().set_timestamp(1_000_000);

            let governed = deploy_governed(&env);
            let mut nonces = vec![0u64; 5];

            let args = soroban_sdk::vec![&env, 2u32.into_val(&env)];
            let proposal_id = governed.gov.propose(
                &governed.signers.get(0).unwrap(),
                &governed.oc_addr,
                &Symbol::new(&env, "set_signature_threshold"),
                &args,
                &Symbol::new(&env, "ratify"),
                &0,
            );
            nonces[0] += 1;

            governed.gov.vote_approve(
                &governed.signers.get(1).unwrap(),
                &proposal_id,
                &0,
            );
            governed.gov.vote_approve(
                &governed.signers.get(2).unwrap(),
                &proposal_id,
                &0,
            );
            governed.gov.vote_approve(
                &governed.signers.get(3).unwrap(),
                &proposal_id,
                &0,
            );
            assert_eq!(
                governed.gov.get_proposal(&proposal_id).status,
                ProposalStatus::Queued
            );

            env.ledger().set_timestamp(1_000_000 + TIMELOCK - 1);
            let result = governed
                .gov
                .try_execute(&governed.signers.get(0).unwrap(), &proposal_id, &1);
            assert_eq!(result, Err(Ok(GovernanceError::TimelockNotElapsed)));

            env.ledger().set_timestamp(1_000_000 + TIMELOCK);
            governed
                .gov
                .execute(&governed.signers.get(0).unwrap(), &proposal_id, &1);

            assert_eq!(governed.oc.get_signature_threshold(), 2);
        }

        #[test]
        fn test_below_quorum_cannot_execute() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();
            env.ledger().set_timestamp(1_000_000);

            let governed = deploy_governed(&env);
            let mut nonces = vec![0u64; 5];

            let args = soroban_sdk::vec![&env, 4u32.into_val(&env)];
            let proposal_id = governed.gov.propose(
                &governed.signers.get(0).unwrap(),
                &governed.oc_addr,
                &Symbol::new(&env, "set_signature_threshold"),
                &args,
                &Symbol::new(&env, "ratify"),
                &0,
            );
            nonces[0] += 1;

            governed.gov.vote_approve(
                &governed.signers.get(1).unwrap(),
                &proposal_id,
                &0,
            );
            governed.gov.vote_approve(
                &governed.signers.get(2).unwrap(),
                &proposal_id,
                &0,
            );
            assert_eq!(
                governed.gov.get_proposal(&proposal_id).status,
                ProposalStatus::Pending
            );
            assert_eq!(governed.oc.get_signature_threshold(), 1);

            env.ledger().set_timestamp(1_000_000 + TIMELOCK);
            let result = governed
                .gov
                .try_execute(&governed.signers.get(0).unwrap(), &proposal_id, &1);
            assert_eq!(result, Err(Ok(GovernanceError::NotQueued)));

            governed.gov.vote_approve(
                &governed.signers.get(3).unwrap(),
                &proposal_id,
                &0,
            );
            assert_eq!(
                governed.gov.get_proposal(&proposal_id).status,
                ProposalStatus::Queued
            );

            env.ledger().set_timestamp(1_000_000 + 2 * TIMELOCK);
            governed
                .gov
                .execute(&governed.signers.get(0).unwrap(), &proposal_id, &1);

            assert_eq!(governed.oc.get_signature_threshold(), 4);
        }

        #[test]
        fn test_veto_quorum_rejects_proposal() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();
            env.ledger().set_timestamp(1_000_000);

            let governed = deploy_governed(&env);
            let mut nonces = vec![0u64; 5];

            let args = soroban_sdk::vec![&env, 5u32.into_val(&env)];
            let proposal_id = governed.gov.propose(
                &governed.signers.get(0).unwrap(),
                &governed.oc_addr,
                &Symbol::new(&env, "set_signature_threshold"),
                &args,
                &Symbol::new(&env, "ratify"),
                &0,
            );
            nonces[0] += 1;

            governed.gov.vote_veto(&governed.signers.get(1).unwrap(), &proposal_id, &0);
            governed.gov.vote_veto(&governed.signers.get(2).unwrap(), &proposal_id, &0);
            governed.gov.vote_veto(&governed.signers.get(3).unwrap(), &proposal_id, &0);

            assert_eq!(
                governed.gov.get_proposal(&proposal_id).status,
                ProposalStatus::Rejected
            );

            env.ledger().set_timestamp(1_000_000 + TIMELOCK);
            let result = governed
                .gov
                .try_execute(&governed.signers.get(0).unwrap(), &proposal_id, &1);
            assert_eq!(result, Err(Ok(GovernanceError::NotQueued)));

            assert_eq!(governed.oc.get_signature_threshold(), 1);
        }

        #[test]
        fn test_governance_approves_project() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();
            env.ledger().set_timestamp(1_000_000);

            let governed = deploy_governed(&env);
            let mut nonces = vec![0u64; 5];

            let user = Address::generate(&env);
            let pid = governed.pr.register_project(
                &user,
                &make_ipfs_hash(&env, 1),
                &Symbol::new(&env, "VCS"),
                &Symbol::new(&env, "US"),
                &0,
            );
            assert_eq!(
                governed.pr.get_project(&pid).status,
                ProjectStatus::Pending
            );

            let args = soroban_sdk::vec![&env, pid.into_val(&env)];
            ratify_and_execute(
                &env,
                &governed.gov,
                &governed.signers,
                &mut nonces,
                &governed.pr_addr,
                &Symbol::new(&env, "approve_project"),
                &args,
            );

            assert_eq!(
                governed.pr.get_project(&pid).status,
                ProjectStatus::Approved
            );
        }

        #[test]
        fn test_non_signer_cannot_participate() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let governed = deploy_governed(&env);
            let outsider = Address::generate(&env);
            let args = soroban_sdk::vec![&env, 2u32.into_val(&env)];

            let result = governed.gov.try_propose(
                &outsider,
                &governed.oc_addr,
                &Symbol::new(&env, "set_signature_threshold"),
                &args,
                &Symbol::new(&env, "ratify"),
                &0,
            );
            assert_eq!(result, Err(Ok(GovernanceError::NotSigner)));

            let proposal_id = governed.gov.propose(
                &governed.signers.get(0).unwrap(),
                &governed.oc_addr,
                &Symbol::new(&env, "set_signature_threshold"),
                &args,
                &Symbol::new(&env, "ratify"),
                &0,
            );
            let result = governed
                .gov
                .try_vote_approve(&outsider, &proposal_id, &0);
            assert_eq!(result, Err(Ok(GovernanceError::NotSigner)));
        }

        #[test]
        fn test_duplicate_vote_is_rejected() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let governed = deploy_governed(&env);
            let args = soroban_sdk::vec![&env, 2u32.into_val(&env)];

            let proposal_id = governed.gov.propose(
                &governed.signers.get(0).unwrap(),
                &governed.oc_addr,
                &Symbol::new(&env, "set_signature_threshold"),
                &args,
                &Symbol::new(&env, "ratify"),
                &0,
            );

            governed.gov.vote_approve(&governed.signers.get(1).unwrap(), &proposal_id, &0);
            let result = governed
                .gov
                .try_vote_approve(&governed.signers.get(1).unwrap(), &proposal_id, &1);
            assert_eq!(result, Err(Ok(GovernanceError::AlreadyVoted)));
            assert_eq!(
                governed.gov.get_proposal(&proposal_id).approval_count,
                1
            );
        }

        #[test]
        fn test_cancel_pending_proposal() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();

            let governed = deploy_governed(&env);
            let args = soroban_sdk::vec![&env, 2u32.into_val(&env)];

            let proposal_id = governed.gov.propose(
                &governed.signers.get(0).unwrap(),
                &governed.oc_addr,
                &Symbol::new(&env, "set_signature_threshold"),
                &args,
                &Symbol::new(&env, "ratify"),
                &0,
            );

            governed.gov.cancel(&governed.signers.get(1).unwrap(), &proposal_id, &0);
            assert_eq!(
                governed.gov.get_proposal(&proposal_id).status,
                ProposalStatus::Cancelled
            );
        }

        #[test]
        fn test_multiple_sequential_executions_keep_nonce_sync() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();
            env.ledger().set_timestamp(1_000_000);

            let governed = deploy_governed(&env);
            let mut nonces = vec![0u64; 5];

            for threshold in [2u32, 4, 5] {
                let args = soroban_sdk::vec![&env, threshold.into_val(&env)];
                ratify_and_execute(
                    &env,
                    &governed.gov,
                    &governed.signers,
                    &mut nonces,
                    &governed.oc_addr,
                    &Symbol::new(&env, "set_signature_threshold"),
                    &args,
                );
            }

            assert_eq!(governed.oc.get_signature_threshold(), 5);
        }

        #[test]
        fn test_governance_matures_bond() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();
            env.ledger().set_timestamp(1_000_000);

            let governed = deploy_governed(&env);
            let mut nonces = vec![0u64; 5];

            let config = make_bond_config(&env, make_project_id(&env, 1), 10_000);
            let args = soroban_sdk::vec![&env, config.clone().into_val(&env)];
            let bond_id = ratify_and_execute(
                &env,
                &governed.gov,
                &governed.signers,
                &mut nonces,
                &governed.bi_addr,
                &Symbol::new(&env, "issue_bond"),
                &args,
            );
            assert_eq!(bond_id, 1);
            assert_eq!(
                governed.bi.get_bond_state(&bond_id).status,
                BondStatus::Active
            );

            env.ledger().set_timestamp(config.maturity_date);

            let args = soroban_sdk::vec![&env, bond_id.into_val(&env)];
            ratify_and_execute(
                &env,
                &governed.gov,
                &governed.signers,
                &mut nonces,
                &governed.bi_addr,
                &Symbol::new(&env, "mature_bond"),
                &args,
            );

            assert_eq!(
                governed.bi.get_bond_state(&bond_id).status,
                BondStatus::Matured
            );
        }

        #[test]
        fn test_governance_executes_dex_admin_cleanup() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();
            env.ledger().set_timestamp(1_000_000);

            let governed = deploy_governed(&env);
            let mut nonces = vec![0u64; 5];

            let config = make_bond_config(&env, make_project_id(&env, 1), 10_000);
            let args = soroban_sdk::vec![&env, config.clone().into_val(&env)];
            let bond_id = ratify_and_execute(
                &env,
                &governed.gov,
                &governed.signers,
                &mut nonces,
                &governed.bi_addr,
                &Symbol::new(&env, "issue_bond"),
                &args,
            );

            let seller = Address::generate(&env);
            governed.bi.subscribe(&seller, &bond_id, &1_000, &0);
            let order_id = governed.dr.list_bond_tokens(
                &seller,
                &bond_id,
                &1_000,
                &10,
                &Symbol::new(&env, "USDC"),
                &60,
                &0,
            );
            assert_eq!(order_id, 1);

            env.ledger().set_timestamp(1_000_100);

            let args = soroban_sdk::vec![&env];
            ratify_and_execute(
                &env,
                &governed.gov,
                &governed.signers,
                &mut nonces,
                &governed.dr_addr,
                &Symbol::new(&env, "clean_expired_orders"),
                &args,
            );

            let order = governed.dr.get_order(&order_id);
            assert_eq!(order.status, OrderStatus::Expired);
        }

        #[test]
        fn test_governance_executes_coupon_engine_admin() {
            let env = Env::default();
            env.mock_all_auths_allowing_non_root_auth();
            env.ledger().set_timestamp(1_000_000);

            let governed = deploy_governed(&env);
            let mut nonces = vec![0u64; 5];

            let project_id = make_project_id(&env, 1);
            let args = soroban_sdk::vec![
                &env,
                1u64.into_val(&env),
                project_id.clone().into_val(&env),
            ];
            ratify_and_execute(
                &env,
                &governed.gov,
                &governed.signers,
                &mut nonces,
                &governed.ce_addr,
                &Symbol::new(&env, "register_bond"),
                &args,
            );

            assert_eq!(governed.ce.get_period_count(&1), 0);
        }
    }
}
