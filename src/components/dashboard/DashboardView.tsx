import React from 'react';
import {
  FilePlus2,
  Camera,
  DatabaseBackup,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  CircleDollarSign,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { Budget, Equipment, StudioSettings } from '../../types';
import { formatBRL } from '../../financial/engine';
import { ActiveView } from '../layout/Sidebar';

interface DashboardViewProps {
  budgets: Budget[];
  equipment: Equipment[];
  settings: StudioSettings | null;
  onNavigate: (view: ActiveView) => void;
  onOpenBudget: (id: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  budgets,
  equipment,
  settings,
  onNavigate,
  onOpenBudget,
}) => {
  // Cálculos consolidados a partir do banco de dados real
  const totalBudgets = budgets.length;
  const draftBudgets = budgets.filter((b) => b.status === 'draft').length;
  const emittedProposals = budgets.filter((b) => b.status === 'proposal_sent').length;
  const approvedBudgets = budgets.filter((b) => b.status === 'approved').length;

  let totalPipelinePrice = 0;
  let totalEstimatedCost = 0;
  let totalEstimatedProfit = 0;
  let lowMarginOrDeficitCount = 0;
  let incompleteDataCount = 0;

  for (const b of budgets) {
    const summary = b.calculatedSummary || {};
    const price = Number(summary.finalBasePrice) || 0;
    const cost = Number(summary.totalCost) || 0;
    const profit = Number(summary.estimatedProfit) || 0;

    totalPipelinePrice += price;
    totalEstimatedCost += cost;
    totalEstimatedProfit += profit;

    if (summary.status === 'deficit' || summary.status === 'low_margin') {
      lowMarginOrDeficitCount++;
    }
    if (summary.status === 'incomplete_data' || cost <= 0) {
      incompleteDataCount++;
    }
  }

  const averageMargin =
    totalPipelinePrice > 0 ? (totalEstimatedProfit / totalPipelinePrice) * 100 : 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Studio Banner & Welcome */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xs">
        <div>
          <span className="text-xs font-semibold text-emerald-700 tracking-wider uppercase">
            Painel Estratégico de Precificação
          </span>
          <h2 className="text-2xl font-bold text-slate-900 mt-1">
            {settings?.studio_name || 'FBonilha - Produtora Audiovisual'}
          </h2>
          <p className="text-sm text-slate-500 mt-1 max-w-xl">
            Cálculo analítico de depreciação, rateio de custos fixos por hora faturável e formação de preço com propostas comerciais sem exposição de custos internos.
          </p>
        </div>

        {/* Quick Action Shortcuts */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            onClick={() => onNavigate('new_budget')}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs"
          >
            <FilePlus2 className="w-4 h-4" />
            <span>Criar Orçamento</span>
          </button>
          <button
            onClick={() => onNavigate('equipment')}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Camera className="w-4 h-4 text-slate-500" />
            <span>Cadastrar Equipamento</span>
          </button>
          <button
            onClick={() => onNavigate('backup')}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <DatabaseBackup className="w-4 h-4 text-slate-500" />
            <span>Backup</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Pipeline Orçado */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Pipeline Orçado</span>
            <CircleDollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {formatBRL(totalPipelinePrice)}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            <span>{totalBudgets} orçamentos salvos no sistema</span>
          </div>
        </div>

        {/* Card 2: Custos Totais Previstos */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Custos Operacionais</span>
            <Clock className="w-4 h-4 text-slate-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {formatBRL(totalEstimatedCost)}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            <span>Mão de obra, depreciação, fixos e equipe</span>
          </div>
        </div>

        {/* Card 3: Lucro Projetado & Margem Média */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Lucro Líquido Estimado</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums">
            {formatBRL(totalEstimatedProfit)}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            <span>Margem média de {averageMargin.toFixed(1)}% sobre as vendas</span>
          </div>
        </div>

        {/* Card 4: Status do Pipeline Comercial */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Situação dos Projetos</span>
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {approvedBudgets} <span className="text-sm font-normal text-slate-500">aprovados</span>
          </div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-2">
            <span>{emittedProposals} emitidos</span>
            <span aria-hidden="true">·</span>
            <span>{draftBudgets} em elaboração</span>
          </div>
        </div>
      </div>

      {/* Alertas Operacionais de Rentabilidade */}
      {(lowMarginOrDeficitCount > 0 || incompleteDataCount > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-4 text-amber-900 shadow-xs">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <h4 className="font-semibold text-amber-950">Atenção Gerencial na Precificação</h4>
            <p className="mt-1 text-amber-800">
              {lowMarginOrDeficitCount > 0 && (
                <span>
                  Existem <strong>{lowMarginOrDeficitCount}</strong> projeto(s) com margem abaixo da meta configurada ou em risco de déficit operacional.{' '}
                </span>
              )}
              {incompleteDataCount > 0 && (
                <span>
                  <strong>{incompleteDataCount}</strong> projeto(s) possuem dados de custos incompletos que necessitam de revisão.
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Tabela de Orçamentos Recentes */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Orçamentos Recentes</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Últimas propostas e estudos de viabilidade financeira salvos no banco local
            </p>
          </div>
          <button
            onClick={() => onNavigate('budgets_list')}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 transition-colors"
          >
            <span>Ver todos ({totalBudgets})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {budgets.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-slate-500 mb-4">Nenhum orçamento cadastrado ainda.</p>
            <button
              onClick={() => onNavigate('new_budget')}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              <span>Criar Primeiro Orçamento</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/75 border-b border-slate-100 text-xs font-medium text-slate-500">
                <tr>
                  <th className="py-3 px-6">Código / Projeto</th>
                  <th className="py-3 px-6">Cliente</th>
                  <th className="py-3 px-6">Custo Operacional</th>
                  <th className="py-3 px-6">Preço de Venda</th>
                  <th className="py-3 px-6">Margem</th>
                  <th className="py-3 px-6">Situação</th>
                  <th className="py-3 px-6 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {budgets.slice(0, 5).map((b) => {
                  const summary = b.calculatedSummary || {};
                  const price = Number(summary.finalBasePrice) || 0;
                  const cost = Number(summary.totalCost) || 0;
                  const margin = summary.effectiveMarginPct;

                  return (
                    <tr key={b.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-6">
                        <div className="font-semibold text-slate-900">{b.title}</div>
                        <div className="text-xs text-slate-400 font-mono">{b.code}</div>
                      </td>
                      <td className="py-3.5 px-6">
                        <div className="text-slate-800">{b.client_name}</div>
                        {b.client_company && (
                          <div className="text-xs text-slate-400">{b.client_company}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-6 font-mono text-slate-600 tabular-nums">
                        {formatBRL(cost)}
                      </td>
                      <td className="py-3.5 px-6 font-mono font-semibold text-slate-900 tabular-nums">
                        {formatBRL(price)}
                      </td>
                      <td className="py-3.5 px-6">
                        {margin !== null && margin !== undefined ? (
                          <span
                            className={`font-semibold tabular-nums text-xs ${
                              margin >= (b.pricingConfig?.desiredProfitMarginPct || 20)
                                ? 'text-emerald-700'
                                : margin > 0
                                ? 'text-amber-700'
                                : 'text-red-700'
                            }`}
                          >
                            {margin.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-6">
                        <StatusLabel status={b.status} />
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <button
                          onClick={() => onOpenBudget(b.id)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
                        >
                          Abrir
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export const StatusLabel: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'draft':
      return <span className="text-xs font-medium text-slate-600">Em elaboração</span>;
    case 'calculated':
      return <span className="text-xs font-medium text-blue-700">Calculado</span>;
    case 'proposal_sent':
      return <span className="text-xs font-medium text-purple-700">Proposta emitida</span>;
    case 'approved':
      return <span className="text-xs font-medium text-emerald-700">Aprovado</span>;
    case 'rejected':
      return <span className="text-xs font-medium text-red-700">Recusado</span>;
    case 'archived':
      return <span className="text-xs font-medium text-slate-400">Arquivado</span>;
    default:
      return <span className="text-xs text-slate-500">{status}</span>;
  }
};
