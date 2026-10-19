import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Save,
  FileDown,
  Send,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Plus,
  ArrowLeft,
  Coins,
  Clock,
  Camera,
  Users2,
  Sparkles,
  Calculator,
  PieChart,
  FileText,
  Search,
} from 'lucide-react';
import {
  Budget,
  BudgetStage,
  BudgetEquipmentItem,
  BudgetProfessionalItem,
  BudgetExpenseItem,
  Equipment,
  RecurringExpense,
  ExpenseCatalogItem,
  Professional,
  ProductionTemplate,
  StudioSettings,
  BudgetStatus,
} from '../../types';
import {
  calculateEquipmentDepreciation,
  calculateOwnLabor,
  calculateOverheadAllocation,
  calculateThirdPartyCost,
  calculateProjectPricing,
  formatBRL,
  formatHours,
  parseHoursAndMinutes,
  parseAndValidateQuantity,
  validateCashDiscount,
  calculateMaterialItemCost,
} from '../../financial/engine';
import { generateCommercialProposalPdf, sanitizeFileName } from '../../utils/pdfGenerator';
import { StatusLabel } from '../dashboard/DashboardView';

interface BudgetEditorViewProps {
  initialBudget: Partial<Budget>;
  equipmentCatalog: Equipment[];
  recurringExpenses: RecurringExpense[];
  expenseCatalog: ExpenseCatalogItem[];
  professionalsCatalog: Professional[];
  templates: ProductionTemplate[];
  settings: StudioSettings | null;
  onSaveBudget: (budget: Partial<Budget>) => Promise<Budget>;
  onEmitProposal: (budgetId: string, payload: any) => Promise<void>;
  onBack: () => void;
}

export type EditorTab =
  | 'identification'
  | 'stages'
  | 'equipment'
  | 'professionals'
  | 'expenses'
  | 'pricing'
  | 'results'
  | 'proposal';

export const BudgetEditorView: React.FC<BudgetEditorViewProps> = ({
  initialBudget,
  equipmentCatalog,
  recurringExpenses,
  expenseCatalog,
  professionalsCatalog,
  templates,
  settings,
  onSaveBudget,
  onEmitProposal,
  onBack,
}) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('identification');

  // Estado central do orçamento (com snapshots e dados desacoplados de cadastros gerais)
  const [budget, setBudget] = useState<Partial<Budget>>({
    title: initialBudget.title || 'Novo Orçamento Audiovisual',
    client_name: initialBudget.client_name || '',
    client_company: initialBudget.client_company || '',
    client_email: initialBudget.client_email || '',
    client_phone: initialBudget.client_phone || '',
    description: initialBudget.description || '',
    scope_summary: initialBudget.scope_summary || '',
    internal_notes: initialBudget.internal_notes || '',
    responsible: initialBudget.responsible || 'FBonilha',
    status: (initialBudget.status as BudgetStatus) || 'draft',
    template_id: initialBudget.template_id || null,
    stages: initialBudget.stages || [
      { id: 's1', name: 'Planejamento e Roteiro', hours: 3, hourlyRate: settings?.default_hourly_rate || 150, commercialGroup: 'pre', isProfessionalLabor: true, isOverheadEligible: true },
      { id: 's2', name: 'Captação Principal', hours: 6, hourlyRate: settings?.default_hourly_rate || 150, commercialGroup: 'prod', isProfessionalLabor: true, isOverheadEligible: true },
      { id: 's3', name: 'Edição e Finalização', hours: 8, hourlyRate: settings?.default_hourly_rate || 150, commercialGroup: 'post', isProfessionalLabor: true, isOverheadEligible: true },
    ],
    equipment: initialBudget.equipment || [],
    professionals: initialBudget.professionals || [],
    expenses: initialBudget.expenses || [],
    pricingConfig: initialBudget.pricingConfig || {
      method: settings?.default_pricing_method ?? 'margin_on_sale',
      desiredProfitMarginPct: settings?.default_profit_margin_pct ?? 25,
      desiredMarkupPct: settings?.default_markup_pct ?? 35,
      taxPct: settings?.default_tax_pct ?? 6,
      financialFeePct: settings?.default_financial_fee_pct ?? 2.5,
      fixedTransactionFee: settings?.default_fixed_fee ?? 0,
      customPriceOverride: null,
      cashDiscountPct: settings?.default_cash_discount_pct ?? 10,
      installmentCount: settings?.default_installments ?? 4,
    },
    id: initialBudget.id,
    code: initialBudget.code,
  });

  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [feedback, setFeedback] = useState<string | null>(null);

  // 1. Cálculo da Mão de Obra Própria (M)
  const laborCalc = useMemo(() => {
    return calculateOwnLabor(
      (budget.stages || []).map((s) => ({
        id: s.id,
        name: s.name,
        hours: Number(s.hours) || 0,
        hourlyRate: Number(s.hourlyRate) || 0,
        isProfessionalLabor: s.isProfessionalLabor,
        isOverheadEligible: s.isOverheadEligible,
      }))
    );
  }, [budget.stages]);

  // 2. Cálculo da Depreciação de Equipamentos (E)
  const equipmentDepreciationCalc = useMemo(() => {
    let totalDepreciation = 0;
    let totalRentalCost = 0;

    for (const item of budget.equipment || []) {
      const depCost = (Number(item.hourlyDepreciation) || 0) * (Number(item.hoursUsed) || 0);
      totalDepreciation += depCost;
      totalRentalCost += Number(item.additionalRentalCost) || 0;
    }

    return {
      totalDepreciation: Math.round(totalDepreciation * 100) / 100,
      totalRentalCost: Math.round(totalRentalCost * 100) / 100,
      totalEquipmentCost: Math.round((totalDepreciation + totalRentalCost) * 100) / 100,
    };
  }, [budget.equipment]);

  // 3. Cálculo do Rateio de Custos Fixos (F)
  const overheadCalc = useMemo(() => {
    const monthlyTotal = recurringExpenses
      .filter((e) => e.is_active === 1 && e.accounting_method === 'overhead_allocated')
      .reduce((sum, e) => sum + (Number(e.monthly_value) || 0), 0);

    const billableForecast = settings?.default_billable_hours_month || 100;
    const eligibleHours = laborCalc.overheadEligibleHours;

    return calculateOverheadAllocation(monthlyTotal, billableForecast, eligibleHours);
  }, [recurringExpenses, settings, laborCalc.overheadEligibleHours]);

  // 4. Cálculo de Terceiros e Equipe (T)
  const thirdPartyCalc = useMemo(() => {
    let totalCost = 0;
    for (const p of budget.professionals || []) {
      totalCost += calculateThirdPartyCost({
        hiringType: p.hiringType,
        unitValue: p.unitValue,
        quantity: p.quantity,
        hoursOrDays: p.hoursOrDays,
        additionalExpenses: p.additionalExpenses,
      });
    }
    return Math.round(totalCost * 100) / 100;
  }, [budget.professionals]);

  // 5. Cálculo de Despesas Extras e Serviços (S + X)
  const expensesCalc = useMemo(() => {
    let totalDirect = 0;
    for (const ex of budget.expenses || []) {
      if (ex.accountingMethod === 'direct_project') {
        const cost = calculateMaterialItemCost(Number(ex.unitValue) || 0, ex.quantity);
        totalDirect += cost;
      }
    }
    return Math.round(totalDirect * 100) / 100;
  }, [budget.expenses]);

  // 6. Motor Completo de Precificação e Rentabilidade
  const pricingAnalysis = useMemo(() => {
    const costs = {
      laborCost: laborCalc.totalLaborCost,
      depreciationCost: equipmentDepreciationCalc.totalEquipmentCost,
      overheadCost: overheadCalc.allocatedOverheadCost,
      servicesAndExtrasCost: expensesCalc,
      thirdPartyCost: thirdPartyCalc,
      otherDirectExpensesCost: 0,
    };

    return calculateProjectPricing(
      costs,
      budget.pricingConfig as any,
      laborCalc.totalProfessionalHours
    );
  }, [
    laborCalc.totalLaborCost,
    laborCalc.totalProfessionalHours,
    equipmentDepreciationCalc.totalEquipmentCost,
    overheadCalc.allocatedOverheadCost,
    expensesCalc,
    thirdPartyCalc,
    budget.pricingConfig,
  ]);

  // Atualizar summary no estado do orçamento
  useEffect(() => {
    setBudget((prev) => ({
      ...prev,
      calculatedSummary: pricingAnalysis,
    }));
  }, [pricingAnalysis]);

  // Salvar alterações
  const handleSave = async () => {
    try {
      setSaveStatus('saving');
      const saved = await onSaveBudget({
        ...budget,
        calculatedSummary: pricingAnalysis,
      });
      setBudget(saved);
      setSaveStatus('saved');
      setFeedback('Orçamento salvo com sucesso no banco de dados SQLite.');
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setSaveStatus('dirty');
      alert(`Erro ao salvar orçamento: ${err.message}`);
    }
  };

  // Gerar PDF da Proposta Comercial (Local, sem expor dados internos!)
  const handleDownloadPdf = () => {
    if (!settings) return;

    let preH = 0;
    let prodH = 0;
    let postH = 0;
    for (const s of budget.stages || []) {
      const h = Number(s.hours) || 0;
      if (s.commercialGroup === 'pre') preH += h;
      else if (s.commercialGroup === 'prod') prodH += h;
      else postH += h;
    }

    const now = new Date();
    const issueDate = now.toISOString().slice(0, 10);
    const validDays = Number(settings.proposal_valid_days) || 7;
    const validUntilDate = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const doc = generateCommercialProposalPdf({
      proposalCode: budget.code || 'ORC-2026-001',
      clientName: budget.client_name || 'Cliente',
      clientCompany: budget.client_company,
      clientEmail: budget.client_email,
      clientPhone: budget.client_phone,
      projectTitle: budget.title || 'Produção Audiovisual',
      scopeSummary: budget.scope_summary || budget.description || '',
      commercialHours: {
        preProductionHours: preH,
        productionHours: prodH,
        postProductionHours: postH,
      },
      totalPrice: pricingAnalysis.finalBasePrice,
      cashDiscountPct: budget.pricingConfig?.cashDiscountPct || 10,
      cashPrice: pricingAnalysis.paymentSimulation.cash.price,
      installmentCount: budget.pricingConfig?.installmentCount || 4,
      installmentValue: pricingAnalysis.paymentSimulation.installments.installmentValue,
      issueDate,
      validUntilDate,
      settings,
      customNotes: budget.internal_notes ? undefined : undefined, // nunca expor internal_notes!
    });

    const safeTitle = sanitizeFileName(budget.title || 'Proposta');
    const fileName = `Proposta_FBonilha_${safeTitle}_${issueDate}.pdf`;
    doc.save(fileName);
  };

  // Emitir Proposta formal
  const handleEmitProposal = async () => {
    if (!budget.id) {
      alert('Salve o orçamento antes de emitir a proposta comercial.');
      return;
    }

    if (
      confirm(
        'Confirmar emissão formal da proposta comercial? Será registrado um snapshot histórico definitivo com validade de 7 dias e o status será atualizado.'
      )
    ) {
      try {
        await onEmitProposal(budget.id, {
          totalPrice: pricingAnalysis.finalBasePrice,
          cashDiscountPct: budget.pricingConfig?.cashDiscountPct || 10,
          cashPrice: pricingAnalysis.paymentSimulation.cash.price,
          installmentCount: budget.pricingConfig?.installmentCount || 4,
        });
        setBudget((prev) => ({ ...prev, status: 'proposal_sent' }));
        alert('Proposta comercial emitida e snapshot histórico registrado!');
      } catch (err: any) {
        alert(`Erro ao emitir proposta: ${err.message}`);
      }
    }
  };

  // Carregar dados de um Modelo
  const handleApplyTemplate = (tplId: string) => {
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;

    if (
      confirm(
        `Deseja preencher este orçamento com as etapas, equipamentos e margens do modelo "${tpl.name}"? Os dados atuais serão substituídos por uma cópia independente deste modelo.`
      )
    ) {
      setBudget((prev) => ({
        ...prev,
        template_id: tpl.id,
        stages: JSON.parse(JSON.stringify(tpl.stages || [])),
        equipment: JSON.parse(JSON.stringify(tpl.equipment || [])),
        professionals: JSON.parse(JSON.stringify(tpl.professionals || [])),
        expenses: JSON.parse(JSON.stringify(tpl.expenses || [])),
        pricingConfig: {
          ...prev.pricingConfig,
          ...(tpl.pricingConfig || {}),
        },
      }));
      setSaveStatus('dirty');
    }
  };

  // Tabs configuration
  const tabs = [
    { id: 'identification' as EditorTab, label: '1. Identificação' },
    { id: 'stages' as EditorTab, label: '2. Etapas e Horas' },
    { id: 'equipment' as EditorTab, label: '3. Equipamentos' },
    { id: 'professionals' as EditorTab, label: '4. Equipe' },
    { id: 'expenses' as EditorTab, label: '5. Despesas' },
    { id: 'pricing' as EditorTab, label: '6. Formação de Preço' },
    { id: 'results' as EditorTab, label: '7. Resultado Financeiro' },
    { id: 'proposal' as EditorTab, label: '8. Proposta & PDF' },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Bar com Ações e Auto-Save Indicator */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
            title="Voltar para lista"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 truncate">
                {budget.title || 'Orçamento Sem Título'}
              </h2>
              {budget.code && (
                <span className="text-xs text-slate-400 font-mono">[{budget.code}]</span>
              )}
              <StatusLabel status={budget.status || 'draft'} />
            </div>
            <p className="text-xs text-slate-500">
              Cliente: {budget.client_name || 'Não informado'} · Custo: {formatBRL(pricingAnalysis.totalCost)} · Preço: {formatBRL(pricingAnalysis.finalBasePrice)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="text-xs text-slate-400 mr-2 flex items-center gap-1.5">
            {saveStatus === 'saving' && <span className="text-slate-500">Gravando no SQLite...</span>}
            {saveStatus === 'saved' && (
              <span className="text-emerald-700 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Salvo no banco
              </span>
            )}
            {saveStatus === 'dirty' && (
              <span className="text-amber-600">Alterações pendentes</span>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors shadow-xs"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Salvar</span>
          </button>

          <button
            onClick={handleDownloadPdf}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-xs"
          >
            <FileDown className="w-3.5 h-3.5 text-slate-500" />
            <span>Baixar Proposta PDF</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">
          {feedback}
        </div>
      )}

      {/* Navegação entre as 8 Abas */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ABA 1: IDENTIFICAÇÃO */}
      {activeTab === 'identification' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">Identificação do Projeto &amp; Cliente</h3>
              <p className="text-xs text-slate-500">Dados cadastrais e escopo da proposta comercial</p>
            </div>

            {/* Carregar a partir de Modelo */}
            {templates.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">Importar Modelo:</label>
                <select
                  onChange={(e) => {
                    if (e.target.value) handleApplyTemplate(e.target.value);
                  }}
                  defaultValue=""
                  className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:ring-1 focus:ring-emerald-700"
                >
                  <option value="" disabled>
                    Selecionar modelo...
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Título do Projeto *
              </label>
              <input
                type="text"
                required
                value={budget.title || ''}
                onChange={(e) => {
                  setBudget({ ...budget, title: e.target.value });
                  setSaveStatus('dirty');
                }}
                placeholder="Ex: Vídeo Institucional 2026 - Apex Industrial"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nome do Cliente / Contato Principal *
              </label>
              <input
                type="text"
                required
                value={budget.client_name || ''}
                onChange={(e) => {
                  setBudget({ ...budget, client_name: e.target.value });
                  setSaveStatus('dirty');
                }}
                placeholder="Ex: Marina Albuquerque"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Empresa / Marca
              </label>
              <input
                type="text"
                value={budget.client_company || ''}
                onChange={(e) => {
                  setBudget({ ...budget, client_company: e.target.value });
                  setSaveStatus('dirty');
                }}
                placeholder="Ex: Apex Industrial Ltda"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                E-mail do Cliente
              </label>
              <input
                type="email"
                value={budget.client_email || ''}
                onChange={(e) => {
                  setBudget({ ...budget, client_email: e.target.value });
                  setSaveStatus('dirty');
                }}
                placeholder="contato@cliente.com"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Telefone / WhatsApp
              </label>
              <input
                type="text"
                value={budget.client_phone || ''}
                onChange={(e) => {
                  setBudget({ ...budget, client_phone: e.target.value });
                  setSaveStatus('dirty');
                }}
                placeholder="(11) 98888-7777"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Situação do Orçamento
              </label>
              <select
                value={budget.status || 'draft'}
                onChange={(e) => {
                  setBudget({ ...budget, status: e.target.value as any });
                  setSaveStatus('dirty');
                }}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              >
                <option value="draft">Em elaboração</option>
                <option value="calculated">Calculado</option>
                <option value="proposal_sent">Proposta emitida</option>
                <option value="approved">Aprovado pelo cliente</option>
                <option value="rejected">Recusado</option>
                <option value="archived">Arquivado</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Responsável pelo Projeto
              </label>
              <input
                type="text"
                value={budget.responsible || 'FBonilha'}
                onChange={(e) => {
                  setBudget({ ...budget, responsible: e.target.value });
                  setSaveStatus('dirty');
                }}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Escopo Resumido para a Proposta Comercial (Visível no PDF do cliente)
              </label>
              <textarea
                rows={3}
                value={budget.scope_summary || ''}
                onChange={(e) => {
                  setBudget({ ...budget, scope_summary: e.target.value });
                  setSaveStatus('dirty');
                }}
                placeholder="Ex: Produção de vídeo institucional de 2 minutos, incluindo gravação com 2 câmeras 4K em 1 diária de estúdio, captação de depoimentos e edição com trilha sonora e vinheta animada."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Anotações Internas Privadas (NUNCA exibidas no PDF ou proposta comercial)
              </label>
              <textarea
                rows={2}
                value={budget.internal_notes || ''}
                onChange={(e) => {
                  setBudget({ ...budget, internal_notes: e.target.value });
                  setSaveStatus('dirty');
                }}
                placeholder="Observações confidenciais, histórico de negociação, lembretes de agenda..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: ETAPAS E HORAS */}
      {activeTab === 'stages' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">Etapas de Trabalho &amp; Mão de Obra Própria</h3>
              <p className="text-xs text-slate-500">
                Horas de dedicação técnica do profissional e remuneração correspondente (Custo M)
              </p>
            </div>
            <button
              onClick={() => {
                const newStage: BudgetStage = {
                  id: `s_${Date.now()}`,
                  name: 'Nova Etapa de Produção',
                  hours: 2,
                  hourlyRate: settings?.default_hourly_rate || 150,
                  commercialGroup: 'prod',
                  isProfessionalLabor: true,
                  isOverheadEligible: true,
                };
                setBudget({ ...budget, stages: [...(budget.stages || []), newStage] });
                setSaveStatus('dirty');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Adicionar Etapa</span>
            </button>
          </div>

          {/* Tabela de Etapas */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/75 border-b border-slate-100 text-xs font-medium text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Nome da Etapa</th>
                  <th className="py-2.5 px-4">Grupo Comercial</th>
                  <th className="py-2.5 px-4 w-28">Horas</th>
                  <th className="py-2.5 px-4 w-32">Valor/Hora (R$)</th>
                  <th className="py-2.5 px-4">Custo da Etapa</th>
                  <th className="py-2.5 px-4">Rateio Fixo?</th>
                  <th className="py-2.5 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(budget.stages || []).map((stage, idx) => {
                  const stageCost = (Number(stage.hours) || 0) * (Number(stage.hourlyRate) || 0);

                  return (
                    <tr key={stage.id || idx} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-4">
                        <input
                          type="text"
                          value={stage.name}
                          onChange={(e) => {
                            const updated = [...(budget.stages || [])];
                            updated[idx].name = e.target.value;
                            setBudget({ ...budget, stages: updated });
                            setSaveStatus('dirty');
                          }}
                          className="w-full px-2 py-1 text-xs border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700"
                        />
                      </td>
                      <td className="py-2.5 px-4">
                        <select
                          value={stage.commercialGroup}
                          onChange={(e) => {
                            const updated = [...(budget.stages || [])];
                            updated[idx].commercialGroup = e.target.value as any;
                            setBudget({ ...budget, stages: updated });
                            setSaveStatus('dirty');
                          }}
                          className="px-2 py-1 text-xs border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700"
                        >
                          <option value="pre">Pré-Produção</option>
                          <option value="prod">Captação</option>
                          <option value="post">Pós-Produção</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          value={stage.hours}
                          onChange={(e) => {
                            const updated = [...(budget.stages || [])];
                            updated[idx].hours = parseFloat(e.target.value) || 0;
                            setBudget({ ...budget, stages: updated });
                            setSaveStatus('dirty');
                          }}
                          className="w-20 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700 tabular-nums"
                        />
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={stage.hourlyRate}
                          onChange={(e) => {
                            const updated = [...(budget.stages || [])];
                            updated[idx].hourlyRate = parseFloat(e.target.value) || 0;
                            setBudget({ ...budget, stages: updated });
                            setSaveStatus('dirty');
                          }}
                          className="w-24 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700 tabular-nums"
                        />
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-800 tabular-nums">
                        {formatBRL(stageCost)}
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="checkbox"
                          checked={stage.isOverheadEligible !== false}
                          onChange={(e) => {
                            const updated = [...(budget.stages || [])];
                            updated[idx].isOverheadEligible = e.target.checked;
                            setBudget({ ...budget, stages: updated });
                            setSaveStatus('dirty');
                          }}
                          className="rounded text-emerald-700 focus:ring-emerald-700"
                        />
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          onClick={() => {
                            const updated = (budget.stages || []).filter((_, i) => i !== idx);
                            setBudget({ ...budget, stages: updated });
                            setSaveStatus('dirty');
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Subtotal da Mão de Obra */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-600 gap-2">
            <div>
              <span>Total de Horas Profissionais: </span>
              <strong className="font-mono text-slate-900">{laborCalc.totalProfessionalHours.toFixed(1)}h</strong>
              <span className="ml-3">Horas Elegíveis ao Rateio: </span>
              <strong className="font-mono text-slate-900">{laborCalc.overheadEligibleHours.toFixed(1)}h</strong>
            </div>
            <div>
              <span className="font-semibold text-slate-800">Custo Total da Mão de Obra (M): </span>
              <strong className="font-mono font-bold text-sm text-emerald-700 ml-1">
                {formatBRL(laborCalc.totalLaborCost)}
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* ABA 3: EQUIPAMENTOS */}
      {activeTab === 'equipment' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">Equipamentos Utilizados &amp; Depreciação</h3>
              <p className="text-xs text-slate-500">
                Seleção de patrimônio e cálculo de depreciação por hora no projeto (Custo E)
              </p>
            </div>
          </div>

          {/* Picker de Equipamento */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center gap-3">
            <label className="text-xs font-semibold text-slate-700 shrink-0">
              Adicionar Equipamento da Biblioteca:
            </label>
            <select
              id="equipmentPicker"
              defaultValue=""
              onChange={(e) => {
                const eqId = e.target.value;
                if (!eqId) return;
                const eq = equipmentCatalog.find((x) => x.id === eqId);
                if (!eq) return;

                const dep = calculateEquipmentDepreciation({
                  purchaseValue: eq.purchase_value,
                  residualValue: eq.residual_value,
                  method: eq.estimation_method,
                  totalUsefulHours: eq.total_useful_hours,
                  annualHours: eq.annual_hours,
                  usefulYears: eq.useful_life_years,
                });

                const newItem: BudgetEquipmentItem = {
                  equipmentId: eq.id,
                  name: eq.name,
                  category: eq.category,
                  hoursUsed: 6, // padrão inicial
                  hourlyDepreciation: dep.hourlyDepreciation,
                  additionalRentalCost: 0,
                };

                setBudget({
                  ...budget,
                  equipment: [...(budget.equipment || []), newItem],
                });
                setSaveStatus('dirty');
                e.target.value = '';
              }}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:ring-1 focus:ring-emerald-700 flex-1 max-w-md"
            >
              <option value="" disabled>
                Selecione um equipamento cadastrado...
              </option>
              {equipmentCatalog
                .filter((eq) => eq.is_active === 1)
                .map((eq) => {
                  const dep = calculateEquipmentDepreciation({
                    purchaseValue: eq.purchase_value,
                    residualValue: eq.residual_value,
                    method: eq.estimation_method,
                    totalUsefulHours: eq.total_useful_hours,
                    annualHours: eq.annual_hours,
                    usefulYears: eq.useful_life_years,
                  });
                  return (
                    <option key={eq.id} value={eq.id}>
                      {eq.name} ({eq.category}) — R$ {dep.hourlyDepreciation.toFixed(2)}/h
                    </option>
                  );
                })}
            </select>
          </div>

          {/* Tabela de Equipamentos Selecionados */}
          {(budget.equipment || []).length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              Nenhum equipamento adicionado a este projeto ainda. Selecione um item acima.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/75 border-b border-slate-100 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Equipamento</th>
                    <th className="py-2.5 px-4">Depreciação/Hora</th>
                    <th className="py-2.5 px-4 w-28">Horas no Projeto</th>
                    <th className="py-2.5 px-4 w-32">Locação/Manutenção Extra (R$)</th>
                    <th className="py-2.5 px-4">Custo Calculado</th>
                    <th className="py-2.5 px-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(budget.equipment || []).map((item, idx) => {
                    const itemCost =
                      (Number(item.hourlyDepreciation) || 0) * (Number(item.hoursUsed) || 0) +
                      (Number(item.additionalRentalCost) || 0);

                    return (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">{item.name}</div>
                          {item.category && (
                            <div className="text-[11px] text-slate-400">{item.category}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600 tabular-nums">
                          R$ {Number(item.hourlyDepreciation || 0).toFixed(2)}/h
                        </td>
                        <td className="py-2.5 px-4">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={item.hoursUsed}
                            onChange={(e) => {
                              const updated = [...(budget.equipment || [])];
                              updated[idx].hoursUsed = parseFloat(e.target.value) || 0;
                              setBudget({ ...budget, equipment: updated });
                              setSaveStatus('dirty');
                            }}
                            className="w-20 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700 tabular-nums"
                          />
                        </td>
                        <td className="py-2.5 px-4">
                          <input
                            type="number"
                            min="0"
                            step="10"
                            value={item.additionalRentalCost}
                            onChange={(e) => {
                              const updated = [...(budget.equipment || [])];
                              updated[idx].additionalRentalCost = parseFloat(e.target.value) || 0;
                              setBudget({ ...budget, equipment: updated });
                              setSaveStatus('dirty');
                            }}
                            className="w-24 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700 tabular-nums"
                          />
                        </td>
                        <td className="py-2.5 px-4 font-mono font-semibold text-slate-800 tabular-nums">
                          {formatBRL(itemCost)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            onClick={() => {
                              const updated = (budget.equipment || []).filter((_, i) => i !== idx);
                              setBudget({ ...budget, equipment: updated });
                              setSaveStatus('dirty');
                            }}
                            className="p-1 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Subtotal Equipamentos */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <div>
              <span>Depreciação pura: {formatBRL(equipmentDepreciationCalc.totalDepreciation)}</span>
              <span className="mx-2">·</span>
              <span>Locações extras: {formatBRL(equipmentDepreciationCalc.totalRentalCost)}</span>
            </div>
            <div>
              <span className="font-semibold text-slate-800">Custo Total de Equipamentos (E): </span>
              <strong className="font-mono font-bold text-sm text-emerald-700 ml-1">
                {formatBRL(equipmentDepreciationCalc.totalEquipmentCost)}
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* ABA 4: EQUIPE (TERCEIRIZADOS) */}
      {activeTab === 'professionals' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">Equipe Técnica &amp; Prestadores Terceirizados</h3>
              <p className="text-xs text-slate-500">
                Assistentes, som direto, drone, operadores e freelancers por diária ou hora (Custo T)
              </p>
            </div>
          </div>

          {/* Picker de Profissionais */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center gap-3">
            <label className="text-xs font-semibold text-slate-700 shrink-0">
              Adicionar Profissional Cadastrado:
            </label>
            <select
              defaultValue=""
              onChange={(e) => {
                const proId = e.target.value;
                if (!proId) return;
                const p = professionalsCatalog.find((x) => x.id === proId);
                if (!p) return;

                const newItem: BudgetProfessionalItem = {
                  professionalId: p.id,
                  name: p.name,
                  specialty: p.specialty,
                  hiringType: p.hiring_type,
                  unitValue: p.default_value,
                  quantity: 1,
                  hoursOrDays: 1,
                  additionalExpenses: 0,
                };

                setBudget({
                  ...budget,
                  professionals: [...(budget.professionals || []), newItem],
                });
                setSaveStatus('dirty');
                e.target.value = '';
              }}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:ring-1 focus:ring-emerald-700 flex-1 max-w-md"
            >
              <option value="" disabled>
                Selecione um profissional cadastrado...
              </option>
              {professionalsCatalog
                .filter((p) => p.is_active === 1)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.specialty}) — {formatBRL(p.default_value)}/{p.hiring_type === 'hourly' ? 'h' : p.hiring_type === 'daily' ? 'diária' : 'fechado'}
                  </option>
                ))}
            </select>
          </div>

          {/* Tabela de Equipe */}
          {(budget.professionals || []).length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              Nenhum profissional terceirizado alocado a este orçamento.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/75 border-b border-slate-100 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Profissional / Função</th>
                    <th className="py-2.5 px-4">Contratação</th>
                    <th className="py-2.5 px-4 w-24">Valor Unit.</th>
                    <th className="py-2.5 px-4 w-20">Qtd</th>
                    <th className="py-2.5 px-4 w-24">Diárias/Horas</th>
                    <th className="py-2.5 px-4 w-28">Extras (Alim/Transp)</th>
                    <th className="py-2.5 px-4">Subtotal</th>
                    <th className="py-2.5 px-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(budget.professionals || []).map((item, idx) => {
                    const cost = calculateThirdPartyCost({
                      hiringType: item.hiringType,
                      unitValue: item.unitValue,
                      quantity: item.quantity,
                      hoursOrDays: item.hoursOrDays,
                      additionalExpenses: item.additionalExpenses,
                    });

                    return (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">{item.name}</div>
                          {item.specialty && (
                            <div className="text-[11px] text-slate-400">{item.specialty}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <select
                            value={item.hiringType}
                            onChange={(e) => {
                              const updated = [...(budget.professionals || [])];
                              updated[idx].hiringType = e.target.value as any;
                              setBudget({ ...budget, professionals: updated });
                              setSaveStatus('dirty');
                            }}
                            className="px-2 py-1 text-xs border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700"
                          >
                            <option value="daily">Diária</option>
                            <option value="hourly">Hora</option>
                            <option value="fixed">Fechado</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-4">
                          <input
                            type="number"
                            min="0"
                            value={item.unitValue}
                            onChange={(e) => {
                              const updated = [...(budget.professionals || [])];
                              updated[idx].unitValue = parseFloat(e.target.value) || 0;
                              setBudget({ ...budget, professionals: updated });
                              setSaveStatus('dirty');
                            }}
                            className="w-20 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700 tabular-nums"
                          />
                        </td>
                        <td className="py-2.5 px-4">
                          <input
                            type="number"
                            min="0"
                            value={item.quantity}
                            onChange={(e) => {
                              const updated = [...(budget.professionals || [])];
                              const val = e.target.value;
                              const parsed = val === '' ? 0 : parseInt(val, 10);
                              updated[idx].quantity = isNaN(parsed) ? 0 : Math.max(0, parsed);
                              setBudget({ ...budget, professionals: updated });
                              setSaveStatus('dirty');
                            }}
                            className="w-16 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700 tabular-nums"
                          />
                        </td>
                        <td className="py-2.5 px-4">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={item.hoursOrDays}
                            onChange={(e) => {
                              const updated = [...(budget.professionals || [])];
                              const val = e.target.value;
                              const parsed = val === '' ? 0 : parseFloat(val);
                              updated[idx].hoursOrDays = isNaN(parsed) ? 0 : Math.max(0, parsed);
                              setBudget({ ...budget, professionals: updated });
                              setSaveStatus('dirty');
                            }}
                            className="w-16 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700 tabular-nums"
                          />
                        </td>
                        <td className="py-2.5 px-4">
                          <input
                            type="number"
                            min="0"
                            value={item.additionalExpenses}
                            onChange={(e) => {
                              const updated = [...(budget.professionals || [])];
                              updated[idx].additionalExpenses = parseFloat(e.target.value) || 0;
                              setBudget({ ...budget, professionals: updated });
                              setSaveStatus('dirty');
                            }}
                            className="w-20 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700 tabular-nums"
                          />
                        </td>
                        <td className="py-2.5 px-4 font-mono font-semibold text-slate-800 tabular-nums">
                          {formatBRL(cost)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            onClick={() => {
                              const updated = (budget.professionals || []).filter((_, i) => i !== idx);
                              setBudget({ ...budget, professionals: updated });
                              setSaveStatus('dirty');
                            }}
                            className="p-1 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Subtotal Terceiros */}
          <div className="pt-4 border-t border-slate-100 flex justify-end text-xs text-slate-600">
            <div>
              <span className="font-semibold text-slate-800">Custo Total de Terceiros (T): </span>
              <strong className="font-mono font-bold text-sm text-emerald-700 ml-1">
                {formatBRL(thirdPartyCalc)}
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* ABA 5: DESPESAS */}
      {activeTab === 'expenses' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">Assinaturas, Serviços &amp; Materiais Extras</h3>
              <p className="text-xs text-slate-500">
                Licenças musicais, alimentação, SSDs, combustível e insumos (Custos S e X)
              </p>
            </div>
          </div>

          {/* Picker de Despesas */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center gap-3">
            <label className="text-xs font-semibold text-slate-700 shrink-0">
              Adicionar do Catálogo:
            </label>
            <select
              defaultValue=""
              onChange={(e) => {
                const catId = e.target.value;
                if (!catId) return;
                const cat = expenseCatalog.find((x) => x.id === catId);
                if (!cat) return;

                const newItem: BudgetExpenseItem = {
                  expenseId: cat.id,
                  name: cat.name,
                  category: cat.category,
                  costType: cat.cost_type,
                  unitValue: cat.default_value,
                  quantity: 1,
                  accountingMethod: 'direct_project',
                };

                setBudget({
                  ...budget,
                  expenses: [...(budget.expenses || []), newItem],
                });
                setSaveStatus('dirty');
                e.target.value = '';
              }}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:ring-1 focus:ring-emerald-700 flex-1 max-w-md"
            >
              <option value="" disabled>
                Selecione um item do catálogo...
              </option>
              {expenseCatalog
                .filter((c) => c.is_active === 1)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.category}) — {formatBRL(c.default_value)}
                  </option>
                ))}
            </select>
          </div>

          {/* Tabela de Despesas */}
          {(budget.expenses || []).length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              Nenhuma despesa ou insumo extra adicionado a este projeto.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/75 border-b border-slate-100 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Item</th>
                    <th className="py-2.5 px-4">Categoria</th>
                    <th className="py-2.5 px-4 w-28">Valor Unit.</th>
                    <th className="py-2.5 px-4 w-20">Qtd</th>
                    <th className="py-2.5 px-4">Subtotal</th>
                    <th className="py-2.5 px-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(budget.expenses || []).map((item, idx) => {
                    const cost = calculateMaterialItemCost(Number(item.unitValue) || 0, item.quantity);

                    return (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-4 font-semibold text-slate-900">{item.name}</td>
                        <td className="py-2.5 px-4 text-xs text-slate-600">{item.category || 'Geral'}</td>
                        <td className="py-2.5 px-4">
                          <input
                            type="number"
                            min="0"
                            value={item.unitValue}
                            onChange={(e) => {
                              const updated = [...(budget.expenses || [])];
                              updated[idx].unitValue = parseFloat(e.target.value) || 0;
                              setBudget({ ...budget, expenses: updated });
                              setSaveStatus('dirty');
                            }}
                            className="w-20 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700 tabular-nums"
                          />
                        </td>
                        <td className="py-2.5 px-4">
                          <input
                            type="number"
                            min="0"
                            value={item.quantity}
                            onChange={(e) => {
                              const updated = [...(budget.expenses || [])];
                              const val = e.target.value;
                              const parsed = val === '' ? 0 : parseInt(val, 10);
                              updated[idx].quantity = isNaN(parsed) ? 0 : Math.max(0, parsed);
                              setBudget({ ...budget, expenses: updated });
                              setSaveStatus('dirty');
                            }}
                            className="w-16 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700 tabular-nums"
                          />
                        </td>
                        <td className="py-2.5 px-4 font-mono font-semibold text-slate-800 tabular-nums">
                          {formatBRL(cost)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            onClick={() => {
                              const updated = (budget.expenses || []).filter((_, i) => i !== idx);
                              setBudget({ ...budget, expenses: updated });
                              setSaveStatus('dirty');
                            }}
                            className="p-1 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Subtotal Despesas */}
          <div className="pt-4 border-t border-slate-100 flex justify-end text-xs text-slate-600">
            <div>
              <span className="font-semibold text-slate-800">Custo Total de Serviços e Extras (S): </span>
              <strong className="font-mono font-bold text-sm text-emerald-700 ml-1">
                {formatBRL(expensesCalc)}
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* ABA 6: FORMAÇÃO DE PREÇO */}
      {activeTab === 'pricing' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">Formação de Preço &amp; Encargos</h3>
              <p className="text-xs text-slate-500">
                Escolha da estratégia financeira: Margem sobre venda vs Acréscimo sobre custo
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Escolha do Método */}
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Método de Formação de Preço
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setBudget({
                      ...budget,
                      pricingConfig: {
                        ...(budget.pricingConfig as any),
                        method: 'margin_on_sale',
                      },
                    });
                    setSaveStatus('dirty');
                  }}
                  className={`p-4 rounded-xl border text-left transition-all ${
                    budget.pricingConfig?.method === 'margin_on_sale'
                      ? 'border-emerald-700 bg-emerald-50/30 ring-1 ring-emerald-700'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="font-bold text-slate-900 text-sm">Margem de Lucro sobre a Venda</div>
                  <div className="text-xs text-slate-500 mt-1">
                    Fórmula: <code>P = C / (1 − t − f − m)</code>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Ideal para garantir a rentabilidade líquida final sobre a receita recebida.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setBudget({
                      ...budget,
                      pricingConfig: {
                        ...(budget.pricingConfig as any),
                        method: 'markup_on_cost',
                      },
                    });
                    setSaveStatus('dirty');
                  }}
                  className={`p-4 rounded-xl border text-left transition-all ${
                    budget.pricingConfig?.method === 'markup_on_cost'
                      ? 'border-emerald-700 bg-emerald-50/30 ring-1 ring-emerald-700'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="font-bold text-slate-900 text-sm">Acréscimo sobre o Custo (Markup)</div>
                  <div className="text-xs text-slate-500 mt-1">
                    Fórmula: <code>P = C × (1 + a) / (1 − t − f)</code>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Aplica uma taxa percentual direta sobre os custos operacionais.
                  </div>
                </button>
              </div>
            </div>

            {/* Margens e Acréscimos */}
            {budget.pricingConfig?.method === 'margin_on_sale' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Margem de Lucro Desejada (% sobre a venda) *
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="90"
                  value={budget.pricingConfig.desiredProfitMarginPct}
                  onChange={(e) => {
                    setBudget({
                      ...budget,
                      pricingConfig: {
                        ...(budget.pricingConfig as any),
                        desiredProfitMarginPct: parseFloat(e.target.value) || 0,
                      },
                    });
                    setSaveStatus('dirty');
                  }}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Acréscimo Desejado (% sobre o custo / markup) *
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={budget.pricingConfig?.desiredMarkupPct}
                  onChange={(e) => {
                    setBudget({
                      ...budget,
                      pricingConfig: {
                        ...(budget.pricingConfig as any),
                        desiredMarkupPct: parseFloat(e.target.value) || 0,
                      },
                    });
                    setSaveStatus('dirty');
                  }}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700"
                />
              </div>
            )}

            {/* Impostos */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Alíquota de Impostos (% sobre o faturamento)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="50"
                value={budget.pricingConfig?.taxPct}
                onChange={(e) => {
                  setBudget({
                    ...budget,
                    pricingConfig: {
                      ...(budget.pricingConfig as any),
                      taxPct: parseFloat(e.target.value) || 0,
                    },
                  });
                  setSaveStatus('dirty');
                }}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700"
              />
            </div>

            {/* Taxas Financeiras */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Taxas Financeiras (% emissão/cartão/antecipação)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="25"
                value={budget.pricingConfig?.financialFeePct}
                onChange={(e) => {
                  setBudget({
                    ...budget,
                    pricingConfig: {
                      ...(budget.pricingConfig as any),
                      financialFeePct: parseFloat(e.target.value) || 0,
                    },
                  });
                  setSaveStatus('dirty');
                }}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700"
              />
            </div>

            {/* Taxa Fixa */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Taxa Fixa de Transação (R$)
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={budget.pricingConfig?.fixedTransactionFee}
                onChange={(e) => {
                  setBudget({
                    ...budget,
                    pricingConfig: {
                      ...(budget.pricingConfig as any),
                      fixedTransactionFee: parseFloat(e.target.value) || 0,
                    },
                  });
                  setSaveStatus('dirty');
                }}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700"
              />
            </div>

            {/* Preço Comercial Pretendido (Override) */}
            <div className="md:col-span-2 pt-4 border-t border-slate-100">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Preço Comercial Pretendido (Opcional - caso queira arredondar ou negociar valor específico)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  step="50"
                  min="0"
                  placeholder={`Preço sugerido: ${formatBRL(pricingAnalysis.suggestedBasePrice)}`}
                  value={budget.pricingConfig?.customPriceOverride ?? ''}
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : parseFloat(e.target.value);
                    setBudget({
                      ...budget,
                      pricingConfig: {
                        ...(budget.pricingConfig as any),
                        customPriceOverride: val,
                      },
                    });
                    setSaveStatus('dirty');
                  }}
                  className="w-72 px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700"
                />
                {budget.pricingConfig?.customPriceOverride && (
                  <button
                    type="button"
                    onClick={() => {
                      setBudget({
                        ...budget,
                        pricingConfig: {
                          ...(budget.pricingConfig as any),
                          customPriceOverride: null,
                        },
                      });
                      setSaveStatus('dirty');
                    }}
                    className="text-xs text-slate-400 hover:text-slate-700 underline"
                  >
                    Usar preço sugerido pela fórmula
                  </button>
                )}
              </div>
            </div>

            {/* Condições Comerciais Padrão */}
            <div className="md:col-span-2 pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Desconto para Pagamento À Vista (%)
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={budget.pricingConfig?.cashDiscountPct ?? 10}
                  onChange={(e) => {
                    const val = e.target.value;
                    const parsed = val === '' ? 0 : parseFloat(val);
                    setBudget({
                      ...budget,
                      pricingConfig: {
                        ...(budget.pricingConfig as any),
                        cashDiscountPct: isNaN(parsed) ? 0 : parsed,
                      },
                    });
                    setSaveStatus('dirty');
                  }}
                  className={`w-full px-3 py-2 text-xs font-mono border rounded-lg focus:ring-1 focus:ring-emerald-700 ${
                    budget.pricingConfig?.cashDiscountPct !== undefined &&
                    (budget.pricingConfig.cashDiscountPct < 0 || budget.pricingConfig.cashDiscountPct > 100)
                      ? 'border-red-400 bg-red-50 text-red-900'
                      : 'border-slate-200'
                  }`}
                />
                {budget.pricingConfig?.cashDiscountPct !== undefined &&
                  (budget.pricingConfig.cashDiscountPct < 0 || budget.pricingConfig.cashDiscountPct > 100) && (
                    <p className="text-[10px] text-red-600 mt-1 font-medium">
                      O percentual deve estar estritamente entre 0% e 100%.
                    </p>
                  )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Quantidade de Parcelas Sem Juros
                </label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={budget.pricingConfig?.installmentCount ?? 4}
                  onChange={(e) => {
                    const val = e.target.value;
                    const parsed = val === '' ? 1 : parseInt(val, 10);
                    setBudget({
                      ...budget,
                      pricingConfig: {
                        ...(budget.pricingConfig as any),
                        installmentCount: isNaN(parsed) || parsed < 1 ? 1 : Math.min(60, parsed),
                      },
                    });
                    setSaveStatus('dirty');
                  }}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ABA 7: RESULTADO FINANCEIRO */}
      {activeTab === 'results' && (
        <div className="space-y-6">
          {/* Card de Alerta Operacional */}
          <div
            className={`p-5 rounded-xl border flex items-start gap-3.5 shadow-xs ${
              pricingAnalysis.status === 'sustainable'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : pricingAnalysis.status === 'low_margin'
                ? 'bg-amber-50 border-amber-200 text-amber-950'
                : 'bg-red-50 border-red-200 text-red-950'
            }`}
          >
            {pricingAnalysis.status === 'sustainable' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            )}
            <div>
              <h4 className="font-bold text-sm">
                {pricingAnalysis.status === 'sustainable'
                  ? 'Orçamento Saudável e Sustentável'
                  : pricingAnalysis.status === 'low_margin'
                  ? 'Margem Abaixo do Alvo Configurado'
                  : pricingAnalysis.status === 'deficit'
                  ? 'Alerta de Déficit / Prejuízo Operacional'
                  : 'Dados de Custos Incompletos'}
              </h4>
              <p className="text-xs mt-1 leading-relaxed opacity-90">{pricingAnalysis.alertMessage}</p>
            </div>
          </div>

          {/* Destaque Financeiro Superior */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-medium text-slate-500">Custo Total Operacional (C)</span>
              <div className="text-2xl font-bold text-slate-900 mt-1 font-mono tabular-nums">
                {formatBRL(pricingAnalysis.totalCost)}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Soma de M + E + F + S + T + X</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-medium text-slate-500">Preço Mínimo Viável</span>
              <div className="text-2xl font-bold text-slate-700 mt-1 font-mono tabular-nums">
                {formatBRL(pricingAnalysis.minimumPrice)}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Cobre custos + impostos + taxas (0% lucro)</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-medium text-slate-500">Preço de Venda Praticado</span>
              <div className="text-2xl font-bold text-emerald-700 mt-1 font-mono tabular-nums">
                {formatBRL(pricingAnalysis.finalBasePrice)}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {budget.pricingConfig?.customPriceOverride ? 'Definido manualmente' : 'Sugerido pela fórmula'}
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-medium text-slate-500">Lucro Líquido Estimado</span>
              <div
                className={`text-2xl font-bold mt-1 font-mono tabular-nums ${
                  pricingAnalysis.estimatedProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatBRL(pricingAnalysis.estimatedProfit)}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Margem efetiva:{' '}
                <strong>
                  {pricingAnalysis.effectiveMarginPct !== null
                    ? `${pricingAnalysis.effectiveMarginPct.toFixed(1)}%`
                    : '—'}
                </strong>
              </p>
            </div>
          </div>

          {/* Decomposição Completa dos Componentes de Custo */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h4 className="text-sm font-bold text-slate-900 mb-4">
              Decomposição Analítica dos Custos do Projeto
            </h4>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">
                  <strong>M</strong> — Mão de Obra Própria ({laborCalc.totalProfessionalHours.toFixed(1)}h de trabalho)
                </span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatBRL(laborCalc.totalLaborCost)}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">
                  <strong>E</strong> — Depreciação de Equipamentos + Locações
                </span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatBRL(equipmentDepreciationCalc.totalEquipmentCost)}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">
                  <strong>F</strong> — Custos Fixos Rateados (R${overheadCalc.hourlyOverhead.toFixed(2)}/h × {overheadCalc.isValid ? laborCalc.overheadEligibleHours : 0}h)
                </span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatBRL(overheadCalc.allocatedOverheadCost)}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">
                  <strong>S</strong> — Assinaturas, Trilha e Insumos Extras
                </span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatBRL(expensesCalc)}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">
                  <strong>T</strong> — Prestadores Terceirizados &amp; Equipe
                </span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatBRL(thirdPartyCalc)}
                </span>
              </div>

              <div className="flex items-center justify-between pt-2 text-sm font-bold text-slate-900">
                <span>CUSTO OPERACIONAL TOTAL (C)</span>
                <span className="font-mono text-emerald-700 tabular-nums">
                  {formatBRL(pricingAnalysis.totalCost)}
                </span>
              </div>
            </div>
          </div>

          {/* Comparativo de Remuneração da Mão de Obra vs Lucro */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h4 className="text-sm font-bold text-slate-900 mb-2">
              Remuneração Profissional vs. Lucro do Estúdio
            </h4>
            <p className="text-xs text-slate-500 mb-4">
              Conforme as boas práticas da formação de preços para produtoras, a remuneração das horas de trabalho é um custo operacional e o lucro é o excedente financeiro retido pela empresa.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500">Remuneração do Trabalho</span>
                <div className="text-base font-bold text-slate-900 font-mono mt-1 tabular-nums">
                  {formatBRL(laborCalc.totalLaborCost)}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  R$ {pricingAnalysis.professionalHourlyEffectiveYield?.toFixed(2) || '0.00'}/h efetivo
                </div>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500">Lucro Líquido da Produtora</span>
                <div className="text-base font-bold text-emerald-700 font-mono mt-1 tabular-nums">
                  {formatBRL(pricingAnalysis.estimatedProfit)}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Margem de {pricingAnalysis.effectiveMarginPct?.toFixed(1) || '0'}%
                </div>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-slate-500">Retorno Global do Projeto</span>
                <div className="text-base font-bold text-slate-900 font-mono mt-1 tabular-nums">
                  {formatBRL(laborCalc.totalLaborCost + pricingAnalysis.estimatedProfit)}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Trabalho + Lucro da operação</div>
              </div>
            </div>
          </div>

          {/* Simulação de Formas de Pagamento */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <h4 className="text-sm font-bold text-slate-900 mb-4">
              Simulação de Cenários de Pagamento ao Cliente
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Cenário À Vista */}
              <div className="p-4 bg-emerald-50/50 border border-emerald-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide">
                    Condição À Vista ({pricingAnalysis.paymentSimulation.cash.discountPct}% desc.)
                  </span>
                  <span className="text-xs font-semibold text-emerald-700">PIX / Transferência</span>
                </div>
                <div className="text-2xl font-bold text-slate-900 font-mono mt-2 tabular-nums">
                  {formatBRL(pricingAnalysis.paymentSimulation.cash.price)}
                </div>
                <div className="text-xs text-slate-600 mt-2 space-y-1">
                  <div>
                    Desconto oferecido: {formatBRL(pricingAnalysis.paymentSimulation.cash.discountAmount)}
                  </div>
                  <div>
                    Lucro no cenário à vista:{' '}
                    <strong>{formatBRL(pricingAnalysis.paymentSimulation.cash.estimatedProfit)}</strong>{' '}
                    (Margem: {pricingAnalysis.paymentSimulation.cash.effectiveMarginPct?.toFixed(1)}%)
                  </div>
                </div>
              </div>

              {/* Cenário Parcelado */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    Parcelamento em {pricingAnalysis.paymentSimulation.installments.count}x sem juros
                  </span>
                  <span className="text-xs font-semibold text-slate-500">Boleto / Cartão</span>
                </div>
                <div className="text-2xl font-bold text-slate-900 font-mono mt-2 tabular-nums">
                  {pricingAnalysis.paymentSimulation.installments.count}x de{' '}
                  {formatBRL(pricingAnalysis.paymentSimulation.installments.installmentValue)}
                </div>
                <div className="text-xs text-slate-600 mt-2 space-y-1">
                  <div>
                    Total parcelado: {formatBRL(pricingAnalysis.paymentSimulation.installments.totalPrice)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Parcelas com balanço de centavos:{' '}
                    {pricingAnalysis.paymentSimulation.installments.installmentsList
                      .map((val) => formatBRL(val))
                      .join(' + ')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ABA 8: PROPOSTA COMERCIAL & PDF */}
      {activeTab === 'proposal' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Prévia da Proposta Comercial Oficial
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Layout limpo, executivo e confidencial (sem custos internos ou depreciação visíveis)
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleDownloadPdf}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Gerar e Baixar PDF</span>
                </button>

                <button
                  onClick={handleEmitProposal}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-xs"
                >
                  <Send className="w-4 h-4 text-slate-500" />
                  <span>Emitir Proposta Formal</span>
                </button>
              </div>
            </div>

            {/* Simulação Visual do Documento em Tela */}
            <div className="mt-8 border border-slate-200 rounded-lg p-8 sm:p-12 bg-white max-w-3xl mx-auto shadow-md">
              <div className="h-1.5 bg-emerald-700 -mt-8 sm:-mt-12 -mx-8 sm:-mx-12 rounded-t-lg mb-8" />

              {/* Cabeçalho */}
              <div className="flex items-start justify-between pb-6 border-b border-slate-200">
                <div>
                  <h1 className="text-xl font-bold text-emerald-800">
                    {settings?.studio_name || 'FBonilha Audiovisual'}
                  </h1>
                  <p className="text-xs text-slate-500 mt-1">
                    {[settings?.phone, settings?.email, settings?.website].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    PROPOSTA COMERCIAL
                  </span>
                  <div className="text-sm font-bold font-mono text-slate-900">
                    {budget.code || 'ORC-2026-001'}
                  </div>
                </div>
              </div>

              {/* Cliente e Projeto */}
              <div className="my-6 p-4 bg-slate-50 rounded-lg border border-slate-200 flex justify-between items-center text-xs">
                <div>
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
                    PROJETO
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 mt-0.5">{budget.title}</h3>
                  <p className="text-slate-600 mt-0.5">
                    Cliente: <strong>{budget.client_name}</strong>{' '}
                    {budget.client_company && `(${budget.client_company})`}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-slate-500">Emissão: {new Date().toLocaleDateString('pt-BR')}</div>
                  <div className="text-red-700 font-bold mt-0.5">Validade: 7 dias corridos</div>
                </div>
              </div>

              {/* Escopo */}
              <div className="my-6 text-xs">
                <h4 className="font-bold text-slate-900 uppercase tracking-wider mb-2">
                  Escopo dos Serviços
                </h4>
                <p className="text-slate-600 leading-relaxed whitespace-pre-line">
                  {budget.scope_summary ||
                    'Produção audiovisual completa incluindo planejamento, captação cinematográfica 4K, iluminação, áudio dedicado, decupagem, edição e finalização.'}
                </p>
              </div>

              {/* Resumo Comercial das Etapas */}
              <div className="my-6 text-xs">
                <h4 className="font-bold text-slate-900 uppercase tracking-wider mb-3">
                  Cronograma de Dedicação Profissional
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-white border border-slate-200 rounded-lg">
                    <span className="text-slate-500 font-medium">Pré-Produção</span>
                    <div className="text-sm font-bold text-emerald-700 font-mono mt-1">
                      {(
                        (budget.stages || [])
                          .filter((s) => s.commercialGroup === 'pre')
                          .reduce((acc, s) => acc + (Number(s.hours) || 0), 0)
                      ).toFixed(1)}h
                    </div>
                  </div>
                  <div className="p-3 bg-white border border-slate-200 rounded-lg">
                    <span className="text-slate-500 font-medium">Captação</span>
                    <div className="text-sm font-bold text-emerald-700 font-mono mt-1">
                      {(
                        (budget.stages || [])
                          .filter((s) => s.commercialGroup === 'prod')
                          .reduce((acc, s) => acc + (Number(s.hours) || 0), 0)
                      ).toFixed(1)}h
                    </div>
                  </div>
                  <div className="p-3 bg-white border border-slate-200 rounded-lg">
                    <span className="text-slate-500 font-medium">Pós-Produção</span>
                    <div className="text-sm font-bold text-emerald-700 font-mono mt-1">
                      {(
                        (budget.stages || [])
                          .filter((s) => s.commercialGroup === 'post')
                          .reduce((acc, s) => acc + (Number(s.hours) || 0), 0)
                      ).toFixed(1)}h
                    </div>
                  </div>
                </div>
              </div>

              {/* Proposta de Investimento */}
              <div className="my-6 pt-4 border-t border-slate-200">
                <h4 className="font-bold text-slate-900 uppercase tracking-wider mb-3 text-xs">
                  Condições de Pagamento e Investimento
                </h4>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-emerald-50/60 border border-emerald-300 rounded-lg">
                    <span className="text-[11px] font-bold text-emerald-800 uppercase">
                      À VISTA ({pricingAnalysis.paymentSimulation.cash.discountPct}% DESCONTO)
                    </span>
                    <div className="text-xl font-bold text-slate-900 font-mono mt-1">
                      {formatBRL(pricingAnalysis.paymentSimulation.cash.price)}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Transferência PIX ou TED na aprovação da proposta
                    </p>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                    <span className="text-[11px] font-bold text-slate-700 uppercase">
                      PARCELAMENTO EM {pricingAnalysis.paymentSimulation.installments.count}X
                    </span>
                    <div className="text-xl font-bold text-slate-900 font-mono mt-1">
                      {pricingAnalysis.paymentSimulation.installments.count}x de{' '}
                      {formatBRL(pricingAnalysis.paymentSimulation.installments.installmentValue)}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Total: {formatBRL(pricingAnalysis.finalBasePrice)} sem juros
                    </p>
                  </div>
                </div>
              </div>

              {/* Rodapé da Proposta */}
              <div className="pt-6 border-t border-slate-200 text-[10px] text-slate-400 flex justify-between items-center">
                <span>{settings?.studio_name || 'FBonilha Audiovisual'} · Documento oficial de orçamento</span>
                <span>Proposta confidencial</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
