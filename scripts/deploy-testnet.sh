#!/usr/bin/env bash
set -euo pipefail

# ── Source environment ──────────────────────────────────────────
if [ -f .env ]; then
  echo "Sourcing .env"
  set -a
  source .env
  set +a
fi

# ── Configuration ───────────────────────────────────────────────
NETWORK=testnet
ADMIN_ADDRESS="${STELLAR_PUBLIC_KEY:?STELLAR_PUBLIC_KEY not set}"
CONTRACTS=(
  "shared"
  "project-registry"
  "bond-issuer"
  "coupon-engine"
  "oracle-consumer"
  "dex-router"
  "credit-retirement"
)

# Rust package names (hyphens → underscores)
declare -A PKG_MAP=(
  ["shared"]="nbbs-shared"
  ["project-registry"]="nbbs-project-registry"
  ["bond-issuer"]="nbbs-bonds"
  ["coupon-engine"]="nbbs-coupon-engine"
  ["oracle-consumer"]="nbbs-oracle-consumer"
  ["dex-router"]="nbbs-dex-router"
  ["credit-retirement"]="nbbs-credit-retirement"
)

# Env variable names per contract (match api/src)
declare -A ENV_MAP=(
  ["project-registry"]="PROJECT_REGISTRY_ADDRESS"
  ["bond-issuer"]="BOND_ISSUER_ADDRESS"
  ["coupon-engine"]="COUPON_ENGINE_ADDRESS"
  ["oracle-consumer"]="ORACLE_CONSUMER_ADDRESS"
  ["dex-router"]="DEX_ROUTER_ADDRESS"
  ["credit-retirement"]="CREDIT_RETIREMENT_ADDRESS"
)

# Read a value back from .env (updated as deployment progresses)
get_env_value() {
  grep "^${1}=" .env 2>/dev/null | cut -d= -f2
}

echo "Deploying contracts to ${NETWORK} as admin ${ADMIN_ADDRESS}"
echo ""

for contract in "${CONTRACTS[@]}"; do
  pkg="${PKG_MAP[$contract]}"
  wasm_name="${contract//-/_}"
  wasm="target/wasm32-unknown-unknown/release/nbbs_${wasm_name}.wasm"

  echo "── ${contract} ──"

  # Skip shared — it's a library, not deployable
  if [ "$contract" = "shared" ]; then
    echo "  ↪ Building shared library..."
    (cd contracts && soroban contract build --package "$pkg")
    echo "  ✓ Done (library only, no deployment)"
    echo ""
    continue
  fi

  echo "  Building..."
  (cd contracts && soroban contract build --package "$pkg")

  echo "  Deploying..."
  address=$(soroban contract deploy \
    --wasm "contracts/${wasm}" \
    --network "$NETWORK")

  echo "  Address: ${address}"

  echo "  Initializing..."
  constructor_args=(--arg "$ADMIN_ADDRESS")
  case "$contract" in
    dex-router|credit-retirement)
      constructor_args+=(
        --arg "$(get_env_value BOND_ISSUER_ADDRESS)"
        --arg "$(get_env_value COUPON_ENGINE_ADDRESS)"
      )
      ;;
  esac
  soroban contract invoke \
    --id "$address" \
    --fn __constructor \
    "${constructor_args[@]}" \
    --network "$NETWORK"

  # Write to .env
  env_key="${ENV_MAP[$contract]}"
  if grep -q "^#\?${env_key}=" .env 2>/dev/null; then
    sed -i "s/^#\?${env_key}=.*/${env_key}=${address}/" .env
  else
    echo "${env_key}=${address}" >> .env
  fi

  echo "  ✓ ${contract} → ${env_key}=${address}"
  echo ""
done

# ── Summary ─────────────────────────────────────────────────────
echo "══════════════════════════════════════════════════════════════"
echo "  All contracts deployed to ${NETWORK}"
echo "══════════════════════════════════════════════════════════════"
for contract in "${CONTRACTS[@]}"; do
  env_key="${ENV_MAP[$contract]}"
  if [ -n "${env_key:-}" ]; then
    echo "  ${env_key}=$(grep "^${env_key}=" .env | cut -d= -f2)"
  fi
done
echo "══════════════════════════════════════════════════════════════"
