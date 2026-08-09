# Credit Methodology

## Carbon Credit Calculation

credits_per_period = (carbon_sequestered_kg / 1000) * credit_conversion_factor

Where `credit_conversion_factor` is set at bond issuance per methodology:
- VERRA-VCS: 1.0 (standard)
- GOLD-STANDARD: 1.0
- ACR: 0.95 (conservative)
- CAR: 1.05 (includes buffer pool)

## Blue Carbon Credit Calculation

Blue carbon projects cover coastal ecosystems — mangroves, seagrass beds and
saltmarshes — that accumulate carbon at 3–5x the rate of terrestrial forests.

Per-plot carbon stock (t C / ha):

```
carbon_stock = aboveground_biomass
             + aboveground_biomass * root_shoot_ratio
             + belowground_biomass
             + soil_organic_carbon
```

Where `root_shoot_ratio` is the project-specific allometric constant (e.g. 0.8
for mangroves) used to derive additional belowground biomass. Net sequestration
over a reporting period:

```
delta_carbon_t_per_ha = mean(carbon_stock_t_per_ha) - baseline_carbon_t_per_ha
carbon_sequestered_kg = delta_carbon_t_per_ha * area_ha * (44 / 12) * 1000
```

- `baseline_carbon_t_per_ha` is fixed at project registration from the baseline survey.
- The `44 / 12` factor converts tonnes of carbon to tonnes of CO2e (mass ratio of CO2 to atomic C).
- Reports where the mean stock falls below baseline contribute zero credits (conservative, no discounting of prior periods).

## Biodiversity Credit Calculation

Biodiversity credits are calculated using project-specific metrics:
- Habitat hectares restored
- Species Abundance Index (SAI) improvement
- Biodiversity Unit (UK BNG methodology)

## Oracle Data Sources
- Accredited Auditors: annual baseline verification
- Satellite Imagery: monthly NDVI/biomass proxy
- IoT Sensors: continuous soil carbon/moisture
- Blue Carbon Surveys: seasonal plot-level biomass and soil carbon (mangrove, seagrass, saltmarsh)
- Community Monitors: quarterly species surveys
