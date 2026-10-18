import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEquipmentDepreciation,
  parseHoursAndMinutes,
  calculateOwnLabor,
  calculateOverheadAllocation,
  calculateThirdPartyCost,
  calculateProjectPricing,
  validateCashDiscount,
  parseAndValidateQuantity,
  calculateMaterialItemCost,
} from './engine.ts';

test('20.1 - Depreciação Caso 1: Horas totais diretas (3.000h, compra 10.000, residual 1.000)', () => {
  const result = calculateEquipmentDepreciation(
    {
      purchaseValue: 10000,
      residualValue: 1000,
      method: 'total_hours',
      totalUsefulHours: 3000,
    },
    8
  );

  assert.equal(result.isValid, true);
  assert.equal(result.hourlyDepreciation, 3.0);
  assert.equal(result.depreciationCost, 24.0);
});

test('20.1 - Depreciação Caso 2: Horas anuais (600h/ano * 5 anos = 3.000h)', () => {
  const result = calculateEquipmentDepreciation(
    {
      purchaseValue: 10000,
      residualValue: 1000,
      method: 'annual_hours',
      annualHours: 600,
      usefulYears: 5,
    },
    8
  );

  assert.equal(result.isValid, true);
  assert.equal(result.totalUsefulHours, 3000);
  assert.equal(result.hourlyDepreciation, 3.0);
  assert.equal(result.depreciationCost, 24.0);
});

test('20.1 - Depreciação: Casos inválidos (residual > compra, horas zeradas, horas negativas)', () => {
  const invalidResidual = calculateEquipmentDepreciation({
    purchaseValue: 5000,
    residualValue: 6000,
    method: 'total_hours',
    totalUsefulHours: 1000,
  });
  assert.equal(invalidResidual.isValid, false);

  const zeroHours = calculateEquipmentDepreciation({
    purchaseValue: 5000,
    residualValue: 500,
    method: 'total_hours',
    totalUsefulHours: 0,
  });
  assert.equal(zeroHours.isValid, false);

  const negativeUse = calculateEquipmentDepreciation(
    {
      purchaseValue: 5000,
      residualValue: 500,
      method: 'total_hours',
      totalUsefulHours: 1000,
    },
    -5
  );
  assert.equal(negativeUse.isValid, false);
});

test('20.2 - Custos Fixos: Rateio mensal (3.000 / 100h = 30/h; 20h projeto = 600)', () => {
  const result = calculateOverheadAllocation(3000, 100, 20);

  assert.equal(result.isValid, true);
  assert.equal(result.hourlyOverhead, 30.0);
  assert.equal(result.allocatedOverheadCost, 600.0);
});

test('20.2 - Custos Fixos: Prevenção de divisão por zero em horas faturáveis previstas', () => {
  const result = calculateOverheadAllocation(3000, 0, 20);
  assert.equal(result.isValid, false);
  assert.match(result.errorMessage || '', /devem ser maiores que zero/);
});

test('20.3 - Mão de obra própria: Pré 3h @ 150 + Captação 6h @ 150 + Pós 10h @ 150 = 2.850', () => {
  const stages = [
    { name: 'Pré-produção', hours: 3, hourlyRate: 150, isProfessionalLabor: true, isOverheadEligible: true },
    { name: 'Captação', hours: 6, hourlyRate: 150, isProfessionalLabor: true, isOverheadEligible: true },
    { name: 'Pós-produção', hours: 10, hourlyRate: 150, isProfessionalLabor: true, isOverheadEligible: true },
  ];

  const result = calculateOwnLabor(stages);
  assert.equal(result.totalLaborCost, 2850.0);
  assert.equal(result.totalProfessionalHours, 19.0);
  assert.equal(result.overheadEligibleHours, 19.0);
});

test('20.3 - Mão de obra: Conversão de horas e minutos sem ambiguidades (1h30 = 1.5h)', () => {
  const decimalHours = parseHoursAndMinutes(1, 30);
  assert.equal(decimalHours, 1.5);

  const twoHoursFortyFive = parseHoursAndMinutes(2, 45);
  assert.equal(twoHoursFortyFive, 2.75);
});

test('20.4 - Formação de Preço Caso 1: Margem de lucro de 20% sobre venda com 10% impostos (P = C / (1 - t - f - m))', () => {
  // C = 1000, t = 0.10, f = 0, m = 0.20 -> P = 1000 / (1 - 0.10 - 0.20) = 1000 / 0.70 = 1428.5714...
  const costs = {
    laborCost: 1000,
    depreciationCost: 0,
    overheadCost: 0,
    servicesAndExtrasCost: 0,
    thirdPartyCost: 0,
    otherDirectExpensesCost: 0,
  };
  const config = {
    method: 'margin_on_sale' as const,
    desiredProfitMarginPct: 20,
    desiredMarkupPct: 20,
    taxPct: 10,
    financialFeePct: 0,
    fixedTransactionFee: 0,
  };

  const result = calculateProjectPricing(costs, config, 10);
  assert.equal(result.isValid, true);
  assert.equal(result.totalCost, 1000.0);
  assert.equal(result.suggestedBasePrice, 1428.57);
  assert.equal(result.finalBasePrice, 1428.57);
  assert.equal(result.taxAmount, 142.86);
  // Lucro = 1428.57 - 1000 - 142.86 = 285.71 (que corresponde a exatamente 20% de 1428.57)
  assert.equal(result.estimatedProfit, 285.71);
  assert.equal(result.effectiveMarginPct, 20.0);
});

test('20.4 - Formação de Preço Caso 2: Acréscimo (markup) de 20% sobre o custo com 10% impostos (P = C * (1 + a) / (1 - t - f))', () => {
  // C = 1000, a = 0.20, t = 0.10, f = 0 -> P = 1000 * 1.20 / 0.90 = 1200 / 0.90 = 1333.3333...
  const costs = {
    laborCost: 1000,
    depreciationCost: 0,
    overheadCost: 0,
    servicesAndExtrasCost: 0,
    thirdPartyCost: 0,
    otherDirectExpensesCost: 0,
  };
  const config = {
    method: 'markup_on_cost' as const,
    desiredProfitMarginPct: 20,
    desiredMarkupPct: 20,
    taxPct: 10,
    financialFeePct: 0,
    fixedTransactionFee: 0,
  };

  const result = calculateProjectPricing(costs, config, 10);
  assert.equal(result.isValid, true);
  assert.equal(result.totalCost, 1000.0);
  assert.equal(result.suggestedBasePrice, 1333.33);
  // Confirmação explícita de que os métodos produzem resultados distintos
  assert.notEqual(result.suggestedBasePrice, 1428.57);
});

test('20.4 - Formação de Preço: Bloqueio quando soma de taxas e margem >= 100%', () => {
  const costs = {
    laborCost: 1000,
    depreciationCost: 0,
    overheadCost: 0,
    servicesAndExtrasCost: 0,
    thirdPartyCost: 0,
    otherDirectExpensesCost: 0,
  };
  const config = {
    method: 'margin_on_sale' as const,
    desiredProfitMarginPct: 60,
    desiredMarkupPct: 60,
    taxPct: 40,
    financialFeePct: 5,
    fixedTransactionFee: 0,
  };

  const result = calculateProjectPricing(costs, config, 10);
  assert.equal(result.isValid, false);
  assert.match(result.errorMessage || '', /menor que 100%/);
});

test('20.5 - Simulação de Pagamento: Preço-base 2.000, À vista com 10% desc. = 1.800, Parcelado 4x de 500 exatos', () => {
  const costs = {
    laborCost: 1200,
    depreciationCost: 100,
    overheadCost: 100,
    servicesAndExtrasCost: 0,
    thirdPartyCost: 0,
    otherDirectExpensesCost: 0,
  };
  const config = {
    method: 'margin_on_sale' as const,
    desiredProfitMarginPct: 20,
    desiredMarkupPct: 20,
    taxPct: 5,
    financialFeePct: 0,
    fixedTransactionFee: 0,
    customPriceOverride: 2000,
    cashDiscountPct: 10,
    installmentCount: 4,
  };

  const result = calculateProjectPricing(costs, config, 8);
  assert.equal(result.finalBasePrice, 2000.0);
  assert.equal(result.paymentSimulation.cash.price, 1800.0);
  assert.equal(result.paymentSimulation.cash.discountAmount, 200.0);

  const installments = result.paymentSimulation.installments;
  assert.equal(installments.count, 4);
  assert.equal(installments.totalPrice, 2000.0);
  assert.equal(installments.installmentValue, 500.0);

  // Verificação exata da soma das parcelas
  const totalInstallmentsSum = installments.installmentsList.reduce((acc, val) => acc + val, 0);
  assert.equal(Math.round(totalInstallmentsSum * 100), 200000);
});

test('20.5 - Simulação de Pagamento: Ajuste de centavos na última parcela (ex: 1.000 / 3 parcelas)', () => {
  const costs = {
    laborCost: 500,
    depreciationCost: 0,
    overheadCost: 0,
    servicesAndExtrasCost: 0,
    thirdPartyCost: 0,
    otherDirectExpensesCost: 0,
  };
  const config = {
    method: 'margin_on_sale' as const,
    desiredProfitMarginPct: 20,
    desiredMarkupPct: 20,
    taxPct: 0,
    financialFeePct: 0,
    fixedTransactionFee: 0,
    customPriceOverride: 1000,
    cashDiscountPct: 10,
    installmentCount: 3,
  };

  const result = calculateProjectPricing(costs, config, 5);
  const installments = result.paymentSimulation.installments;
  assert.deepEqual(installments.installmentsList, [333.33, 333.33, 333.34]);
  const totalSum = installments.installmentsList.reduce((acc, val) => acc + val, 0);
  assert.equal(totalSum, 1000.0);
});

test('Contratação de terceiros: por hora, diária e valor fechado', () => {
  const hourly = calculateThirdPartyCost({
    hiringType: 'hourly',
    unitValue: 80,
    quantity: 2,
    hoursOrDays: 5,
    additionalExpenses: 50,
  });
  // 2 * 5 * 80 + 50 = 850
  assert.equal(hourly, 850.0);

  const daily = calculateThirdPartyCost({
    hiringType: 'daily',
    unitValue: 600,
    quantity: 1,
    hoursOrDays: 2,
    additionalExpenses: 100,
  });
  // 1 * 2 * 600 + 100 = 1300
  assert.equal(daily, 1300.0);

  const fixed = calculateThirdPartyCost({
    hiringType: 'fixed',
    unitValue: 1500,
    quantity: 1,
  });
  assert.equal(fixed, 1500.0);
});

// =======================================================
// AUDITORIA SEÇÃO 6.1: VALIDAÇÃO DE DESCONTO À VISTA
// =======================================================
test('Auditoria 6.1 - Desconto à vista: 0% de desconto mantém preço integral', () => {
  const val = validateCashDiscount(0);
  assert.equal(val.isValid, true);
  assert.equal(val.value, 0);

  const costs = { laborCost: 1000, depreciationCost: 0, overheadCost: 0, servicesAndExtrasCost: 0, thirdPartyCost: 0, otherDirectExpensesCost: 0 };
  const config = {
    method: 'margin_on_sale' as const,
    desiredProfitMarginPct: 20,
    desiredMarkupPct: 20,
    taxPct: 0,
    financialFeePct: 0,
    fixedTransactionFee: 0,
    customPriceOverride: 2000,
    cashDiscountPct: 0,
  };
  const result = calculateProjectPricing(costs, config);
  assert.equal(result.isValid, true);
  assert.equal(result.paymentSimulation.cash.discountPct, 0);
  assert.equal(result.paymentSimulation.cash.price, 2000.0);
  assert.equal(result.paymentSimulation.cash.discountAmount, 0.0);
});

test('Auditoria 6.1 - Desconto à vista: 10% de desconto comercial padrão (R$ 2.000 -> R$ 1.800)', () => {
  const val = validateCashDiscount(10);
  assert.equal(val.isValid, true);
  assert.equal(val.value, 10);

  const costs = { laborCost: 1000, depreciationCost: 0, overheadCost: 0, servicesAndExtrasCost: 0, thirdPartyCost: 0, otherDirectExpensesCost: 0 };
  const config = {
    method: 'margin_on_sale' as const,
    desiredProfitMarginPct: 20,
    desiredMarkupPct: 20,
    taxPct: 0,
    financialFeePct: 0,
    fixedTransactionFee: 0,
    customPriceOverride: 2000,
    cashDiscountPct: 10,
  };
  const result = calculateProjectPricing(costs, config);
  assert.equal(result.isValid, true);
  assert.equal(result.paymentSimulation.cash.discountPct, 10);
  assert.equal(result.paymentSimulation.cash.price, 1800.0);
  assert.equal(result.paymentSimulation.cash.discountAmount, 200.0);
});

test('Auditoria 6.1 - Desconto à vista: 100% de desconto gera preço à vista zero sem erros', () => {
  const val = validateCashDiscount(100);
  assert.equal(val.isValid, true);
  assert.equal(val.value, 100);

  const costs = { laborCost: 1000, depreciationCost: 0, overheadCost: 0, servicesAndExtrasCost: 0, thirdPartyCost: 0, otherDirectExpensesCost: 0 };
  const config = {
    method: 'margin_on_sale' as const,
    desiredProfitMarginPct: 20,
    desiredMarkupPct: 20,
    taxPct: 0,
    financialFeePct: 0,
    fixedTransactionFee: 0,
    customPriceOverride: 2000,
    cashDiscountPct: 100,
  };
  const result = calculateProjectPricing(costs, config);
  assert.equal(result.isValid, true);
  assert.equal(result.paymentSimulation.cash.discountPct, 100);
  assert.equal(result.paymentSimulation.cash.price, 0.0);
  assert.equal(result.paymentSimulation.cash.discountAmount, 2000.0);
});

test('Auditoria 6.1 - Desconto à vista: Percentual negativo é rejeitado com mensagem clara', () => {
  const val = validateCashDiscount(-15);
  assert.equal(val.isValid, false);
  assert.match(val.errorMessage || '', /não pode ser negativo/i);

  const costs = { laborCost: 1000, depreciationCost: 0, overheadCost: 0, servicesAndExtrasCost: 0, thirdPartyCost: 0, otherDirectExpensesCost: 0 };
  const config = {
    method: 'margin_on_sale' as const,
    desiredProfitMarginPct: 20,
    desiredMarkupPct: 20,
    taxPct: 0,
    financialFeePct: 0,
    fixedTransactionFee: 0,
    customPriceOverride: 2000,
    cashDiscountPct: -15,
  };
  const result = calculateProjectPricing(costs, config);
  assert.equal(result.isValid, false);
  assert.match(result.errorMessage || '', /não pode ser negativo/i);
});

test('Auditoria 6.1 - Desconto à vista: Percentual superior a 100% é rejeitado', () => {
  const val = validateCashDiscount(110);
  assert.equal(val.isValid, false);
  assert.match(val.errorMessage || '', /superior a 100%/i);

  const costs = { laborCost: 1000, depreciationCost: 0, overheadCost: 0, servicesAndExtrasCost: 0, thirdPartyCost: 0, otherDirectExpensesCost: 0 };
  const config = {
    method: 'margin_on_sale' as const,
    desiredProfitMarginPct: 20,
    desiredMarkupPct: 20,
    taxPct: 0,
    financialFeePct: 0,
    fixedTransactionFee: 0,
    customPriceOverride: 2000,
    cashDiscountPct: 150,
  };
  const result = calculateProjectPricing(costs, config);
  assert.equal(result.isValid, false);
  assert.match(result.errorMessage || '', /superior a 100%/i);
});

test('Auditoria 6.1 - Desconto à vista: Campo vazio ou ausente utiliza padrão de 10%', () => {
  const valUndefined = validateCashDiscount(undefined);
  assert.equal(valUndefined.isValid, true);
  assert.equal(valUndefined.value, 10);

  const valEmpty = validateCashDiscount('');
  assert.equal(valEmpty.isValid, true);
  assert.equal(valEmpty.value, 10);
});

test('Auditoria 6.1 - Desconto à vista: Valor não numérico é rejeitado', () => {
  const val = validateCashDiscount('dez por cento');
  assert.equal(val.isValid, false);
  assert.match(val.errorMessage || '', /número válido/i);
});

test('Auditoria 6.1 - Desconto à vista: Valor excessivamente elevado é rejeitado', () => {
  const val = validateCashDiscount(5000);
  assert.equal(val.isValid, false);
  assert.match(val.errorMessage || '', /superior a 100%/i);
});

// =======================================================
// AUDITORIA SEÇÃO 6.2: QUANTIDADES (ZERO, POSITIVO, NEGATIVO, AUSENTE)
// =======================================================
test('Auditoria 6.2 - Quantidade ZERO em terceiros resulta em custo ZERO (não converte em 1)', () => {
  const result = calculateThirdPartyCost({
    hiringType: 'daily',
    unitValue: 600,
    quantity: 0,
    hoursOrDays: 2,
    additionalExpenses: 100,
  });
  // Anteriormente `quantity || 1` gerava 1300! Agora deve ser 0!
  assert.equal(result, 0.0);
});

test('Auditoria 6.2 - Quantidade ZERO em terceiros por hora resulta em custo ZERO', () => {
  const result = calculateThirdPartyCost({
    hiringType: 'hourly',
    unitValue: 120,
    quantity: 0,
    hoursOrDays: 8,
  });
  assert.equal(result, 0.0);
});

test('Auditoria 6.2 - Quantidade negativa em terceiros é rejeitada e resulta em custo 0', () => {
  const parsed = parseAndValidateQuantity(-3);
  assert.equal(parsed.isValid, false);
  assert.match(parsed.errorMessage || '', /não pode ser negativa/i);

  const result = calculateThirdPartyCost({
    hiringType: 'fixed',
    unitValue: 800,
    quantity: -3,
  });
  assert.equal(result, 0.0);
});

test('Auditoria 6.2 - Quantidade ausente utiliza fallback 1 unidade quando esperado', () => {
  const parsed = parseAndValidateQuantity(undefined, 1);
  assert.equal(parsed.isValid, true);
  assert.equal(parsed.value, 1);

  const result = calculateThirdPartyCost({
    hiringType: 'fixed',
    unitValue: 500,
    quantity: undefined as any,
  });
  assert.equal(result, 500.0);
});

test('Auditoria 6.2 - Quantidade em materiais e serviços extras respeita zero e calcula corretamente', () => {
  // Quantidade zero = R$ 0
  assert.equal(calculateMaterialItemCost(180, 0), 0.0);

  // Quantidade positiva (3 unidades a R$ 70 = R$ 210)
  assert.equal(calculateMaterialItemCost(70, 3), 210.0);

  // Quantidade negativa = R$ 0
  assert.equal(calculateMaterialItemCost(180, -2), 0.0);
});

