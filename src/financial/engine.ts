/**
 * Motor de Cálculo Financeiro FBonilha
 * Funções puras, determinísticas e independentes de interface.
 * Tratamento de centavos e prevenção de divisões inválidas.
 */

export type PricingMethod = 'margin_on_sale' | 'markup_on_cost';

export interface DepreciationInput {
  purchaseValue: number; // Em reais ou centavos
  residualValue?: number; // Padrão 0
  method: 'total_hours' | 'annual_hours';
  totalUsefulHours?: number; // Para method 'total_hours'
  annualHours?: number; // Para method 'annual_hours'
  usefulYears?: number; // Para method 'annual_hours'
}

export interface DepreciationResult {
  hourlyDepreciation: number;
  totalUsefulHours: number;
  depreciationCost: number; // para as horas usadas no projeto
  isValid: boolean;
  errorMessage?: string;
}

/**
 * Calcula a depreciação por hora de um equipamento
 */
export function calculateEquipmentDepreciation(
  input: DepreciationInput,
  projectHoursUsed: number = 0
): DepreciationResult {
  const purchase = Number(input.purchaseValue) || 0;
  const residual = Number(input.residualValue) || 0;
  const hoursUsed = Number(projectHoursUsed) || 0;

  if (purchase < 0) {
    return {
      hourlyDepreciation: 0,
      totalUsefulHours: 0,
      depreciationCost: 0,
      isValid: false,
      errorMessage: 'O valor de compra não pode ser negativo.',
    };
  }

  if (residual < 0) {
    return {
      hourlyDepreciation: 0,
      totalUsefulHours: 0,
      depreciationCost: 0,
      isValid: false,
      errorMessage: 'O valor residual não pode ser negativo.',
    };
  }

  if (residual > purchase) {
    return {
      hourlyDepreciation: 0,
      totalUsefulHours: 0,
      depreciationCost: 0,
      isValid: false,
      errorMessage: 'O valor residual não pode ser maior que o valor de compra.',
    };
  }

  if (hoursUsed < 0) {
    return {
      hourlyDepreciation: 0,
      totalUsefulHours: 0,
      depreciationCost: 0,
      isValid: false,
      errorMessage: 'Horas de uso no projeto não podem ser negativas.',
    };
  }

  let totalUsefulHours = 0;
  if (input.method === 'total_hours') {
    totalUsefulHours = Number(input.totalUsefulHours) || 0;
  } else {
    const annualHours = Number(input.annualHours) || 0;
    const usefulYears = Number(input.usefulYears) || 0;
    if (annualHours <= 0 || usefulYears <= 0) {
      return {
        hourlyDepreciation: 0,
        totalUsefulHours: 0,
        depreciationCost: 0,
        isValid: false,
        errorMessage: 'Horas anuais e vida útil em anos devem ser maiores que zero.',
      };
    }
    totalUsefulHours = annualHours * usefulYears;
  }

  if (totalUsefulHours <= 0) {
    return {
      hourlyDepreciation: 0,
      totalUsefulHours: 0,
      depreciationCost: 0,
      isValid: false,
      errorMessage: 'As horas úteis totais devem ser maiores que zero.',
    };
  }

  const depreciableAmount = purchase - residual;
  const hourlyDepreciation = depreciableAmount / totalUsefulHours;
  const depreciationCost = hourlyDepreciation * hoursUsed;

  return {
    hourlyDepreciation: roundToDecimals(hourlyDepreciation, 4),
    totalUsefulHours,
    depreciationCost: roundToDecimals(depreciationCost, 2),
    isValid: true,
  };
}

/**
 * Converte tempo informado (ex: 1h30m ou decimal 1.5) para horas decimais com precisão
 */
export function parseHoursAndMinutes(hours: number, minutes: number = 0): number {
  const h = Math.max(0, Number(hours) || 0);
  const m = Math.max(0, Number(minutes) || 0);
  return roundToDecimals(h + m / 60, 4);
}

/**
 * Calcula o custo da mão de obra própria a partir das etapas do projeto
 */
export interface WorkStageCostItem {
  id?: string;
  name: string;
  hours: number;
  hourlyRate: number;
  isProfessionalLabor: boolean; // se é elegível para remuneração profissional
  isOverheadEligible: boolean; // se é elegível para rateio de custos fixos
}

export interface LaborCalculationResult {
  totalLaborCost: number;
  totalProfessionalHours: number;
  overheadEligibleHours: number;
  stagesBreakdown: Array<{
    name: string;
    hours: number;
    cost: number;
  }>;
}

export function calculateOwnLabor(stages: WorkStageCostItem[]): LaborCalculationResult {
  let totalLaborCost = 0;
  let totalProfessionalHours = 0;
  let overheadEligibleHours = 0;
  const stagesBreakdown: Array<{ name: string; hours: number; cost: number }> = [];

  for (const stage of stages) {
    const hours = Math.max(0, Number(stage.hours) || 0);
    const rate = Math.max(0, Number(stage.hourlyRate) || 0);
    const cost = roundToDecimals(hours * rate, 2);

    if (stage.isProfessionalLabor !== false) {
      totalLaborCost += cost;
      totalProfessionalHours += hours;
    }

    if (stage.isOverheadEligible !== false) {
      overheadEligibleHours += hours;
    }

    stagesBreakdown.push({
      name: stage.name,
      hours,
      cost,
    });
  }

  return {
    totalLaborCost: roundToDecimals(totalLaborCost, 2),
    totalProfessionalHours: roundToDecimals(totalProfessionalHours, 2),
    overheadEligibleHours: roundToDecimals(overheadEligibleHours, 2),
    stagesBreakdown,
  };
}

/**
 * Rateio de custos fixos mensais com base em horas faturáveis previstas
 */
export interface OverheadResult {
  hourlyOverhead: number;
  allocatedOverheadCost: number;
  isValid: boolean;
  errorMessage?: string;
}

export function calculateOverheadAllocation(
  monthlyFixedExpensesTotal: number,
  monthlyBillableHoursForecast: number,
  projectOverheadEligibleHours: number
): OverheadResult {
  const fixedTotal = Math.max(0, Number(monthlyFixedExpensesTotal) || 0);
  const billableForecast = Number(monthlyBillableHoursForecast) || 0;
  const projectHours = Math.max(0, Number(projectOverheadEligibleHours) || 0);

  if (billableForecast <= 0) {
    return {
      hourlyOverhead: 0,
      allocatedOverheadCost: 0,
      isValid: false,
      errorMessage: 'Horas faturáveis previstas por mês devem ser maiores que zero para realizar o rateio.',
    };
  }

  const hourlyOverhead = fixedTotal / billableForecast;
  const allocatedOverheadCost = hourlyOverhead * projectHours;

  return {
    hourlyOverhead: roundToDecimals(hourlyOverhead, 4),
    allocatedOverheadCost: roundToDecimals(allocatedOverheadCost, 2),
    isValid: true,
  };
}

/**
 * Cálculo de Terceiros e Equipe
 */
export interface ProfessionalContractCost {
  hiringType: 'hourly' | 'daily' | 'fixed';
  unitValue: number;
  quantity: number; // número de profissionais ou contratações
  hoursOrDays?: number; // horas ou diárias contratadas
  additionalExpenses?: number; // alimentação, transporte, etc.
}

export function calculateThirdPartyCost(item: ProfessionalContractCost): number {
  const qty = Math.max(0, Number(item.quantity) || 1);
  const unit = Math.max(0, Number(item.unitValue) || 0);
  const additional = Math.max(0, Number(item.additionalExpenses) || 0);

  let base = 0;
  if (item.hiringType === 'hourly') {
    const hours = Math.max(0, Number(item.hoursOrDays) || 0);
    base = qty * hours * unit;
  } else if (item.hiringType === 'daily') {
    const days = Math.max(0, Number(item.hoursOrDays) || 0);
    base = qty * days * unit;
  } else {
    // fixed
    base = qty * unit;
  }

  return roundToDecimals(base + additional, 2);
}

/**
 * Parâmetros de Formação de Preço e Rentabilidade
 */
export interface ProjectCostBreakdown {
  laborCost: number; // M
  depreciationCost: number; // E
  overheadCost: number; // F
  servicesAndExtrasCost: number; // S
  thirdPartyCost: number; // T
  otherDirectExpensesCost: number; // X
}

export interface PricingConfig {
  method: PricingMethod;
  desiredProfitMarginPct: number; // m (ex: 20 para 20%)
  desiredMarkupPct: number; // a (ex: 20 para 20%)
  taxPct: number; // t (ex: 10 para 10%)
  financialFeePct: number; // f (ex: 2 para 2%)
  fixedTransactionFee: number; // taxa fixa por transação
  customPriceOverride?: number | null; // Preço comercial definido manualmente pelo usuário
  cashDiscountPct?: number; // padrão 10%
  installmentCount?: number; // padrão 4
}

export interface PricingAnalysisResult {
  totalCost: number; // C = M + E + F + S + T + X
  minimumPrice: number; // Preço mínimo absoluto para cobrir custos e taxas (sem lucro)
  suggestedBasePrice: number; // Preço sugerido pela fórmula escolhida
  finalBasePrice: number; // Preço considerado (manual se fornecido e válido, senão sugerido)
  
  // Detalhamento de deduções sobre o preço base
  taxAmount: number;
  financialFeeAmount: number;
  estimatedProfit: number; // Receita - Custos - Impostos - Taxas
  effectiveMarginPct: number | null; // Lucro / Receita (null se receita = 0)
  
  // Remuneração e horas
  professionalHourlyEffectiveYield: number | null;
  profitDifferenceFromTarget: number; // Diferença em R$ para a meta
  
  // Alertas
  status: 'sustainable' | 'low_margin' | 'deficit' | 'incomplete_data';
  alertMessage: string;
  suggestedPriceForTargetMargin: number;

  // Condições de pagamento
  paymentSimulation: {
    cash: {
      discountPct: number;
      price: number;
      discountAmount: number;
      taxAmount: number;
      financialFeeAmount: number;
      estimatedProfit: number;
      effectiveMarginPct: number | null;
      isProfitable: boolean;
    };
    installments: {
      count: number;
      totalPrice: number;
      installmentValue: number;
      lastInstallmentValue: number; // Ajuste de centavos se necessário
      installmentsList: number[];
      taxAmount: number;
      financialFeeAmount: number;
      estimatedProfit: number;
      effectiveMarginPct: number | null;
    };
  };

  isValid: boolean;
  errorMessage?: string;
}

export function calculateProjectPricing(
  costs: ProjectCostBreakdown,
  config: PricingConfig,
  totalProfessionalHours: number = 0
): PricingAnalysisResult {
  const M = Math.max(0, Number(costs.laborCost) || 0);
  const E = Math.max(0, Number(costs.depreciationCost) || 0);
  const F = Math.max(0, Number(costs.overheadCost) || 0);
  const S = Math.max(0, Number(costs.servicesAndExtrasCost) || 0);
  const T = Math.max(0, Number(costs.thirdPartyCost) || 0);
  const X = Math.max(0, Number(costs.otherDirectExpensesCost) || 0);

  const fixedFee = Math.max(0, Number(config.fixedTransactionFee) || 0);
  const totalCost = roundToDecimals(M + E + F + S + T + X + fixedFee, 2);

  const t = Math.max(0, (Number(config.taxPct) || 0) / 100);
  const f = Math.max(0, (Number(config.financialFeePct) || 0) / 100);
  const m = Math.max(0, (Number(config.desiredProfitMarginPct) || 0) / 100);
  const a = Math.max(0, (Number(config.desiredMarkupPct) || 0) / 100);

  // Validação dos denominadores
  // Para preço mínimo (margem = 0): denominador = 1 - t - f
  const minDenominator = 1 - t - f;
  if (minDenominator <= 0) {
    return createInvalidPricingResult(
      totalCost,
      `A soma das alíquotas de impostos (${(t * 100).toFixed(1)}%) e taxas (${(f * 100).toFixed(1)}%) é maior ou igual a 100%, impossibilitando a formação de preço.`
    );
  }

  const minimumPrice = roundToDecimals(totalCost / minDenominator, 2);

  let suggestedBasePrice = 0;

  if (config.method === 'margin_on_sale') {
    // P = C / (1 - t - f - m)
    const saleDenominator = 1 - t - f - m;
    if (saleDenominator <= 0) {
      return createInvalidPricingResult(
        totalCost,
        `A soma de impostos (${(t * 100).toFixed(1)}%), taxas (${(f * 100).toFixed(1)}%) e margem desejada (${(m * 100).toFixed(1)}%) deve ser estritamente menor que 100%. Denominador inválido: ${saleDenominator.toFixed(4)}.`
      );
    }
    suggestedBasePrice = roundToDecimals(totalCost / saleDenominator, 2);
  } else {
    // Acréscimo sobre custo: P = C * (1 + a) / (1 - t - f)
    suggestedBasePrice = roundToDecimals((totalCost * (1 + a)) / minDenominator, 2);
  }

  // Preço que atinge a margem alvo de venda (para sugestões)
  const targetSaleDenominator = 1 - t - f - m;
  const suggestedPriceForTargetMargin =
    targetSaleDenominator > 0 ? roundToDecimals(totalCost / targetSaleDenominator, 2) : suggestedBasePrice;

  // Preço final adotado
  const hasManualOverride =
    config.customPriceOverride !== undefined &&
    config.customPriceOverride !== null &&
    !isNaN(Number(config.customPriceOverride)) &&
    Number(config.customPriceOverride) > 0;

  const finalBasePrice = hasManualOverride
    ? roundToDecimals(Number(config.customPriceOverride), 2)
    : suggestedBasePrice;

  // Cálculos no cenário base
  const taxAmount = roundToDecimals(finalBasePrice * t, 2);
  const financialFeeAmount = roundToDecimals(finalBasePrice * f, 2);
  const estimatedProfit = roundToDecimals(
    finalBasePrice - totalCost - taxAmount - financialFeeAmount,
    2
  );

  const effectiveMarginPct =
    finalBasePrice > 0 ? roundToDecimals((estimatedProfit / finalBasePrice) * 100, 2) : null;

  // Remuneração por hora do profissional
  const profHours = Math.max(0, Number(totalProfessionalHours) || 0);
  const professionalHourlyEffectiveYield =
    profHours > 0 ? roundToDecimals(M / profHours, 2) : null;

  // Diferença para meta de lucro
  const targetProfitAmount = roundToDecimals(finalBasePrice * m, 2);
  const profitDifferenceFromTarget = roundToDecimals(estimatedProfit - targetProfitAmount, 2);

  // Diagnóstico e Alertas
  let status: 'sustainable' | 'low_margin' | 'deficit' | 'incomplete_data' = 'sustainable';
  let alertMessage = 'Orçamento financeiramente sustentável com cobertura integral de custos e remuneração.';

  if (totalCost <= 0) {
    status = 'incomplete_data';
    alertMessage = 'Custos insuficientes ou zerados. Preencha etapas de trabalho, equipamentos ou despesas para validar a precificação.';
  } else if (finalBasePrice < minimumPrice || estimatedProfit < 0) {
    status = 'deficit';
    const deficit = Math.abs(estimatedProfit);
    alertMessage = `Atenção: Preço em déficit operacional de ${formatBRL(deficit)}. O preço mínimo viável para cobrir custos e encargos é ${formatBRL(minimumPrice)}. Preço sugerido para margem de ${(m * 100).toFixed(0)}%: ${formatBRL(suggestedPriceForTargetMargin)}.`;
  } else if (effectiveMarginPct !== null && effectiveMarginPct < (config.desiredProfitMarginPct || 0)) {
    status = 'low_margin';
    const diffPct = roundToDecimals((config.desiredProfitMarginPct || 0) - effectiveMarginPct, 1);
    alertMessage = `Margem efetiva (${effectiveMarginPct.toFixed(1)}%) abaixo da meta de ${(config.desiredProfitMarginPct || 0).toFixed(1)}% (diferença de ${diffPct}%). Sugerido: ${formatBRL(suggestedPriceForTargetMargin)}.`;
  }

  // Simulação à vista (default 10% de desconto)
  const cashDiscountPct = config.cashDiscountPct !== undefined ? Number(config.cashDiscountPct) : 10;
  const cashDiscountFactor = 1 - cashDiscountPct / 100;
  const cashPrice = roundToDecimals(finalBasePrice * cashDiscountFactor, 2);
  const cashDiscountAmount = roundToDecimals(finalBasePrice - cashPrice, 2);
  const cashTax = roundToDecimals(cashPrice * t, 2);
  const cashFee = roundToDecimals(cashPrice * f, 2);
  const cashProfit = roundToDecimals(cashPrice - totalCost - cashTax - cashFee, 2);
  const cashMarginPct = cashPrice > 0 ? roundToDecimals((cashProfit / cashPrice) * 100, 2) : null;

  // Simulação parcelada (default 4x sem juros ao cliente)
  const installmentCount = Math.max(1, Math.floor(Number(config.installmentCount) || 4));
  const installmentCents = Math.floor(Math.round(finalBasePrice * 100) / installmentCount);
  const remainderCents = Math.round(finalBasePrice * 100) - installmentCents * installmentCount;

  const installmentsList: number[] = [];
  for (let i = 0; i < installmentCount; i++) {
    const isLast = i === installmentCount - 1;
    const valueInCents = isLast ? installmentCents + remainderCents : installmentCents;
    installmentsList.push(valueInCents / 100);
  }

  const baseInstallmentValue = installmentCents / 100;
  const lastInstallmentValue = (installmentCents + remainderCents) / 100;

  return {
    totalCost,
    minimumPrice,
    suggestedBasePrice,
    finalBasePrice,
    taxAmount,
    financialFeeAmount,
    estimatedProfit,
    effectiveMarginPct,
    professionalHourlyEffectiveYield,
    profitDifferenceFromTarget,
    status,
    alertMessage,
    suggestedPriceForTargetMargin,
    paymentSimulation: {
      cash: {
        discountPct: cashDiscountPct,
        price: cashPrice,
        discountAmount: cashDiscountAmount,
        taxAmount: cashTax,
        financialFeeAmount: cashFee,
        estimatedProfit: cashProfit,
        effectiveMarginPct: cashMarginPct,
        isProfitable: cashProfit >= 0,
      },
      installments: {
        count: installmentCount,
        totalPrice: finalBasePrice,
        installmentValue: baseInstallmentValue,
        lastInstallmentValue,
        installmentsList,
        taxAmount,
        financialFeeAmount,
        estimatedProfit,
        effectiveMarginPct,
      },
    },
    isValid: true,
  };
}

function createInvalidPricingResult(totalCost: number, errorMessage: string): PricingAnalysisResult {
  return {
    totalCost,
    minimumPrice: 0,
    suggestedBasePrice: 0,
    finalBasePrice: 0,
    taxAmount: 0,
    financialFeeAmount: 0,
    estimatedProfit: 0,
    effectiveMarginPct: null,
    professionalHourlyEffectiveYield: null,
    profitDifferenceFromTarget: 0,
    status: 'deficit',
    alertMessage: errorMessage,
    suggestedPriceForTargetMargin: 0,
    paymentSimulation: {
      cash: {
        discountPct: 10,
        price: 0,
        discountAmount: 0,
        taxAmount: 0,
        financialFeeAmount: 0,
        estimatedProfit: 0,
        effectiveMarginPct: null,
        isProfitable: false,
      },
      installments: {
        count: 4,
        totalPrice: 0,
        installmentValue: 0,
        lastInstallmentValue: 0,
        installmentsList: [0, 0, 0, 0],
        taxAmount: 0,
        financialFeeAmount: 0,
        estimatedProfit: 0,
        effectiveMarginPct: null,
      },
    },
    isValid: false,
    errorMessage,
  };
}

/**
 * Utilitários numéricos e formatação BRL
 */
export function roundToDecimals(value: number, decimals: number = 2): number {
  if (isNaN(value) || !isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatBRL(value: number): string {
  if (value === null || value === undefined || isNaN(value)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatHours(hours: number): string {
  if (isNaN(hours) || hours <= 0) return '0h';
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  if (minutes === 0) return `${wholeHours}h`;
  return `${wholeHours}h${minutes.toString().padStart(2, '0')}`;
}
