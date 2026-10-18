import React, { useState } from 'react';
import {
  Plus,
  Search,
  Copy,
  Edit2,
  Trash2,
  FileDown,
  ArrowRight,
  FolderKanban,
} from 'lucide-react';
import { Budget, StudioSettings } from '../../types';
import { formatBRL } from '../../financial/engine';
import { generateCommercialProposalPdf, sanitizeFileName } from '../../utils/pdfGenerator';
import { StatusLabel } from '../dashboard/DashboardView';

interface BudgetListViewProps {
  budgets: Budget[];
  settings: StudioSettings | null;
  onOpenBudget: (id: string) => void;
  onNewBudget: () => void;
  onCloneBudget: (id: string) => Promise<void>;
  onDeleteBudget: (id: string) => Promise<void>;
}

const STATUS_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'draft', label: 'Em elaboração' },
  { id: 'calculated', label: 'Calculados' },
  { id: 'proposal_sent', label: 'Proposta emitida' },
  { id: 'approved', label: 'Aprovados' },
  { id: 'rejected', label: 'Recusados' },
  { id: 'archived', label: 'Arquivados' },
];

export const BudgetListView: React.FC<BudgetListViewProps> = ({
  budgets,
  settings,
  onOpenBudget,
  onNewBudget,
  onCloneBudget,
  onDeleteBudget,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = budgets.filter((b) => {
    const matchesSearch =
      b.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.client_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.client_company || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' || b.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const handleClone = async (id: string) => {
    try {
      await onCloneBudget(id);
      setFeedback('Orçamento duplicado com sucesso com snapshot independente.');
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      alert(`Erro ao duplicar orçamento: ${err.message}`);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (confirm(`Deseja arquivar o orçamento "${title}"?`)) {
      try {
        await onDeleteBudget(id);
        setFeedback('Orçamento arquivado.');
        setTimeout(() => setFeedback(null), 3000);
      } catch (err: any) {
        alert(`Erro ao arquivar: ${err.message}`);
      }
    }
  };

  const handleDownloadPdf = (b: Budget) => {
    if (!settings) return;

    let preH = 0;
    let prodH = 0;
    let postH = 0;
    for (const s of b.stages || []) {
      const h = Number(s.hours) || 0;
      if (s.commercialGroup === 'pre') preH += h;
      else if (s.commercialGroup === 'prod') prodH += h;
      else postH += h;
    }

    const summary = b.calculatedSummary || {};
    const totalPrice = Number(summary.finalBasePrice) || 0;
    const cashDiscountPct = b.pricingConfig?.cashDiscountPct !== undefined ? Number(b.pricingConfig.cashDiscountPct) : 10;
    const cashPrice = Number((totalPrice * (1 - Math.max(0, Math.min(100, cashDiscountPct)) / 100)).toFixed(2));
    const installmentCount = Math.max(1, Math.min(60, Math.floor(Number(b.pricingConfig?.installmentCount) || 4)));
    const installmentValue = Number((totalPrice / installmentCount).toFixed(2));

    const now = new Date();
    const issueDate = now.toISOString().slice(0, 10);
    const validDays = Number(settings.proposal_valid_days) || 7;
    const validUntilDate = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const doc = generateCommercialProposalPdf({
      proposalCode: b.code || 'ORC-2026-001',
      clientName: b.client_name || 'Cliente',
      clientCompany: b.client_company,
      clientEmail: b.client_email,
      clientPhone: b.client_phone,
      projectTitle: b.title || 'Produção Audiovisual',
      scopeSummary: b.scope_summary || b.description || '',
      commercialHours: {
        preProductionHours: preH,
        productionHours: prodH,
        postProductionHours: postH,
      },
      totalPrice,
      cashDiscountPct,
      cashPrice,
      installmentCount,
      installmentValue,
      issueDate,
      validUntilDate,
      settings,
    });

    const safeTitle = sanitizeFileName(b.title || 'Proposta');
    const fileName = `Proposta_FBonilha_${safeTitle}_${issueDate}.pdf`;
    doc.save(fileName);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Orçamentos Salvos &amp; Histórico</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Gerenciamento de estudos financeiros, propostas comerciais emitidas e projetos aprovados
          </p>
        </div>

        <button
          onClick={onNewBudget}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Criar Novo Orçamento</span>
        </button>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">
          {feedback}
        </div>
      )}

      {/* Barra de Filtros e Pesquisa */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4 shadow-xs">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por código, cliente ou projeto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-700 focus:bg-white"
          />
        </div>

        {/* Segmented Filter Control */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto w-full md:w-auto">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                statusFilter === f.id
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela de Orçamentos */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            Nenhum orçamento encontrado com os filtros atuais.
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
                  <th className="py-3 px-6">Margem Efetiva</th>
                  <th className="py-3 px-6">Situação</th>
                  <th className="py-3 px-6">Atualização</th>
                  <th className="py-3 px-6 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((b) => {
                  const summary = b.calculatedSummary || {};
                  const price = Number(summary.finalBasePrice) || 0;
                  const cost = Number(summary.totalCost) || 0;
                  const margin = summary.effectiveMarginPct;

                  return (
                    <tr key={b.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-6">
                        <button
                          onClick={() => onOpenBudget(b.id)}
                          className="font-semibold text-slate-900 hover:text-emerald-700 transition-colors text-left block"
                        >
                          {b.title}
                        </button>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">{b.code}</div>
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

                      <td className="py-3.5 px-6 text-xs text-slate-400">
                        {b.updated_at ? b.updated_at.slice(0, 10).split('-').reverse().join('/') : '—'}
                      </td>

                      <td className="py-3.5 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleDownloadPdf(b)}
                            title="Baixar Proposta em PDF"
                            className="p-1.5 text-slate-400 hover:text-emerald-700 rounded-md hover:bg-emerald-50 transition-colors"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleClone(b.id)}
                            title="Duplicar Orçamento"
                            className="p-1.5 text-slate-400 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onOpenBudget(b.id)}
                            title="Editar Orçamento"
                            className="p-1.5 text-slate-400 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(b.id, b.title)}
                            title="Arquivar"
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
