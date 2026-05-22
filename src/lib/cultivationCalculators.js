// src/lib/cultivationCalculators.js

const DEFAULT_DECIMALS = 2;

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value, fallback = 0) {
  return Math.max(0, numeric(value, fallback));
}

function positiveInt(value, fallback = 1) {
  return Math.max(1, Math.floor(numeric(value, fallback)));
}

export function roundTo(value, decimals = DEFAULT_DECIMALS) {
  const n = numeric(value, 0);
  const places = Math.max(0, Math.floor(numeric(decimals, DEFAULT_DECIMALS)));
  const factor = 10 ** places;
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

export function calculateLiquidCulture(input = {}) {
  const batchVolumeMl = positive(input.batchVolumeMl, 500);
  const sugarPercent = positive(input.sugarPercent, 4);
  const nutrientPercent = positive(input.nutrientPercent, 0);
  const jarCount = positiveInt(input.jarCount, 1);
  const fillPercent = Math.min(95, Math.max(10, numeric(input.fillPercent, 70)));

  const sugarG = (batchVolumeMl * sugarPercent) / 100;
  const nutrientG = (batchVolumeMl * nutrientPercent) / 100;
  const additiveG = sugarG + nutrientG;
  const perJarMl = batchVolumeMl / jarCount;
  const estimatedJarCapacityMl = perJarMl / (fillPercent / 100);

  return {
    batchVolumeMl: roundTo(batchVolumeMl),
    sugarPercent: roundTo(sugarPercent),
    nutrientPercent: roundTo(nutrientPercent),
    sugarG: roundTo(sugarG),
    nutrientG: roundTo(nutrientG),
    additiveG: roundTo(additiveG),
    waterMl: roundTo(batchVolumeMl),
    perJarMl: roundTo(perJarMl),
    estimatedJarCapacityMl: roundTo(estimatedJarCapacityMl),
    jarCount,
    fillPercent: roundTo(fillPercent),
  };
}

export function calculatePopcornPcHydration(input = {}) {
  const dryGrainG = positive(input.dryGrainG, 1000);
  const hydrationGainPercent = positive(input.hydrationGainPercent, 35);
  const targetBagWeightG = positive(input.targetBagWeightG, 960);
  const multiplier = 1 + hydrationGainPercent / 100;
  const hydratedWeightG = dryGrainG * multiplier;
  const absorbedWaterEstimateG = hydratedWeightG - dryGrainG;
  const estimatedFullBags = targetBagWeightG > 0 ? hydratedWeightG / targetBagWeightG : 0;
  const dryGrainPerTargetBagG = targetBagWeightG > 0 ? targetBagWeightG / multiplier : 0;
  const waterPerTargetBagG = targetBagWeightG - dryGrainPerTargetBagG;

  return {
    dryGrainG: roundTo(dryGrainG),
    hydrationGainPercent: roundTo(hydrationGainPercent),
    hydratedWeightG: roundTo(hydratedWeightG),
    absorbedWaterEstimateG: roundTo(absorbedWaterEstimateG),
    targetBagWeightG: roundTo(targetBagWeightG),
    estimatedFullBags: roundTo(estimatedFullBags, 1),
    dryGrainPerTargetBagG: roundTo(dryGrainPerTargetBagG),
    waterPerTargetBagG: roundTo(Math.max(0, waterPerTargetBagG)),
  };
}

export function calculateGrainBatch(input = {}) {
  const targetBags = positiveInt(input.targetBags, 8);
  const targetBagWeightG = positive(input.targetBagWeightG, 960);
  const hydrationGainPercent = positive(input.hydrationGainPercent, 35);
  const overagePercent = positive(input.overagePercent, 5);
  const hydratedTargetG = targetBags * targetBagWeightG;
  const hydratedTargetWithOverageG = hydratedTargetG * (1 + overagePercent / 100);
  const multiplier = 1 + hydrationGainPercent / 100;
  const dryGrainNeededG = hydratedTargetWithOverageG / multiplier;
  const absorbedWaterEstimateG = hydratedTargetWithOverageG - dryGrainNeededG;

  return {
    targetBags,
    targetBagWeightG: roundTo(targetBagWeightG),
    hydrationGainPercent: roundTo(hydrationGainPercent),
    overagePercent: roundTo(overagePercent),
    hydratedTargetG: roundTo(hydratedTargetG),
    hydratedTargetWithOverageG: roundTo(hydratedTargetWithOverageG),
    dryGrainNeededG: roundTo(dryGrainNeededG),
    absorbedWaterEstimateG: roundTo(absorbedWaterEstimateG),
  };
}

export function calculateCvgBatch(input = {}) {
  const targetSubstrateG = positive(input.targetSubstrateG, 5000);
  const dryHydrationMultiplier = positive(input.dryHydrationMultiplier, 4);
  const coirPercent = positive(input.coirPercent, 70);
  const vermiculitePercent = positive(input.vermiculitePercent, 25);
  const gypsumPercent = positive(input.gypsumPercent, 5);
  const totalParts = coirPercent + vermiculitePercent + gypsumPercent || 1;
  const dryTotalG = targetSubstrateG / (1 + dryHydrationMultiplier);
  const waterMl = dryTotalG * dryHydrationMultiplier;

  return {
    targetSubstrateG: roundTo(targetSubstrateG),
    dryHydrationMultiplier: roundTo(dryHydrationMultiplier),
    dryTotalG: roundTo(dryTotalG),
    waterMl: roundTo(waterMl),
    coirG: roundTo((dryTotalG * coirPercent) / totalParts),
    vermiculiteG: roundTo((dryTotalG * vermiculitePercent) / totalParts),
    gypsumG: roundTo((dryTotalG * gypsumPercent) / totalParts),
    coirPercent: roundTo((coirPercent / totalParts) * 100),
    vermiculitePercent: roundTo((vermiculitePercent / totalParts) * 100),
    gypsumPercent: roundTo((gypsumPercent / totalParts) * 100),
  };
}

export function calculateSpawnRatio(input = {}) {
  const spawnG = positive(input.spawnG, 1000);
  const substrateG = positive(input.substrateG, 3000);
  const targetRatio = Math.max(0.1, numeric(input.targetRatio, 3));
  const totalG = spawnG + substrateG;
  const currentRatio = spawnG > 0 ? substrateG / spawnG : 0;
  const spawnPercent = totalG > 0 ? (spawnG / totalG) * 100 : 0;
  const substratePercent = totalG > 0 ? (substrateG / totalG) * 100 : 0;
  const targetSubstrateForSpawnG = spawnG * targetRatio;
  const targetSpawnForSubstrateG = targetRatio > 0 ? substrateG / targetRatio : 0;
  const targetTotalForCurrentSpawnG = spawnG + targetSubstrateForSpawnG;

  return {
    spawnG: roundTo(spawnG),
    substrateG: roundTo(substrateG),
    totalG: roundTo(totalG),
    currentRatio: roundTo(currentRatio, 2),
    spawnPercent: roundTo(spawnPercent, 1),
    substratePercent: roundTo(substratePercent, 1),
    targetRatio: roundTo(targetRatio, 2),
    targetSubstrateForSpawnG: roundTo(targetSubstrateForSpawnG),
    targetSpawnForSubstrateG: roundTo(targetSpawnForSubstrateG),
    targetTotalForCurrentSpawnG: roundTo(targetTotalForCurrentSpawnG),
  };
}
