import { PricingMethod } from '../financial/engine';

export interface StudioSettings {
  id: number;
  studio_name: string;
  logo_url: string;
  primary_color: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  cnpj: string;
  default_hourly_rate: number;
  default_billable_hours_month: number;
  default_pricing_method: PricingMethod;
  default_profit_margin_pct: number;
  default_markup_pct: number;
  default_tax_pct: number;
  default_financial_fee_pct: number;
  default_fixed_fee: number;
  default_cash_discount_pct: number;
  default_installments: number;
  proposal_valid_days: number;
  default_notes: string;
  terms_and_conditions: string;
  updated_at: string;
}

export interface Equipment {
  id: string;
  name: string;
  category: string;
  brand: string;
  model: string;
  serial_number: string;
  acquisition_date: string;
  purchase_value: number;
  residual_value: number;
  useful_life_years: number;
  estimation_method: 'total_hours' | 'annual_hours';
  total_useful_hours: number;
  annual_hours: number;
  notes: string;
  is_active: number;
  is_deleted?: number;
  created_at: string;
  updated_at: string;
}

export interface RecurringExpense {
  id: string;
  name: string;
  category: string;
  monthly_value: number;
  start_date: string;
  end_date: string;
  accounting_method: 'overhead_allocated' | 'direct_project' | 'none';
  notes: string;
  is_active: number;
  is_deleted?: number;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCatalogItem {
  id: string;
  name: string;
  category: string;
  description: string;
  cost_type: 'per_project' | 'monthly_allocated' | 'per_unit' | 'variable';
  default_value: number;
  periodicity: string;
  accounting_method: 'direct_project' | 'overhead_allocated';
  notes: string;
  is_active: number;
  is_deleted?: number;
  created_at: string;
  updated_at: string;
}

export interface Professional {
  id: string;
  name: string;
  specialty: string;
  phone: string;
  email: string;
  hiring_type: 'hourly' | 'daily' | 'fixed';
  default_value: number;
  notes: string;
  is_active: number;
  is_deleted?: number;
  created_at: string;
  updated_at: string;
}

export interface BudgetStage {
  id: string;
  name: string;
  hours: number;
  hourlyRate: number;
  commercialGroup: 'pre' | 'prod' | 'post';
  isProfessionalLabor: boolean;
  isOverheadEligible: boolean;
}

export interface BudgetEquipmentItem {
  equipmentId: string;
  name: string;
  category?: string;
  hoursUsed: number;
  hourlyDepreciation: number;
  additionalRentalCost: number;
}

export interface BudgetProfessionalItem {
  professionalId: string;
  name: string;
  specialty?: string;
  hiringType: 'hourly' | 'daily' | 'fixed';
  unitValue: number;
  quantity: number;
  hoursOrDays: number;
  additionalExpenses: number;
}

export interface BudgetExpenseItem {
  expenseId: string;
  name: string;
  category?: string;
  costType: string;
  unitValue: number;
  quantity: number;
  accountingMethod: 'direct_project' | 'overhead_allocated';
}

export interface ProductionTemplate {
  id: string;
  name: string;
  description: string;
  stages: BudgetStage[];
  equipment: BudgetEquipmentItem[];
  professionals: BudgetProfessionalItem[];
  expenses: BudgetExpenseItem[];
  pricingConfig: {
    method: PricingMethod;
    desiredProfitMarginPct: number;
    desiredMarkupPct: number;
    taxPct: number;
    financialFeePct: number;
    fixedTransactionFee: number;
    cashDiscountPct: number;
    installmentCount: number;
  };
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export type BudgetStatus =
  | 'draft'
  | 'calculated'
  | 'proposal_sent'
  | 'approved'
  | 'rejected'
  | 'archived';

export interface Budget {
  id: string;
  code: string;
  title: string;
  client_name: string;
  client_company: string;
  client_email: string;
  client_phone: string;
  description: string;
  scope_summary: string;
  internal_notes: string;
  responsible: string;
  status: BudgetStatus;
  template_id?: string | null;
  stages: BudgetStage[];
  equipment: BudgetEquipmentItem[];
  professionals: BudgetProfessionalItem[];
  expenses: BudgetExpenseItem[];
  pricingConfig: {
    method: PricingMethod;
    desiredProfitMarginPct: number;
    desiredMarkupPct: number;
    taxPct: number;
    financialFeePct: number;
    fixedTransactionFee: number;
    customPriceOverride?: number | null;
    cashDiscountPct?: number;
    installmentCount?: number;
  };
  calculatedSummary?: any;
  created_at: string;
  updated_at: string;
}

export interface ProposalSnapshot {
  id: string;
  budget_id: string;
  proposal_code: string;
  client_name: string;
  project_title: string;
  scope_summary: string;
  stageHoursSummary: {
    preProductionHours: number;
    productionHours: number;
    postProductionHours: number;
  };
  total_price: number;
  cash_price: number;
  cash_discount_pct: number;
  installment_count: number;
  installment_value: number;
  issue_date: string;
  valid_until_date: string;
  issuerContact: {
    studioName: string;
    phone: string;
    email: string;
    website: string;
    cnpj: string;
    address: string;
  };
  commercial_terms: string;
  created_at: string;
}
