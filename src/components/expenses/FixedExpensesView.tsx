import React, { useState } from 'react';
import { Plus, Coins, Edit2, Trash2, AlertCircle } from 'lucide-react';
import { RecurringExpense, StudioSettings } from '../../types';
import { calculateOverheadAllocation, formatBRL } from '../../financial/engine';

interface FixedExpensesViewProps {
  expenses: RecurringExpense[];
  settings: StudioSettings | null;
  onSaveExpense: (data: Partial<RecurringExpense>) => Promise<void>;
  onDeleteExpense: (id: string) => Promise<void>;
  onUpdateSettings: (data: Partial<StudioSettings>) => Promise<void>;
}

export const FixedExpensesView: React.FC<FixedExpensesViewProps> = ({
  expenses,
  settings,
  onSaveExpense,
  onDeleteExpense,
  onUpdateSettings,
}) => {
  const [billableHours, setBillableHours] = useState<number>(
    settings?.default_billable_hours_month || 100
  );
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<RecurringExpense> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeExpenses = expenses.filter((e) => e.is_active === 1);
  const monthlyTotal = activeExpenses.reduce((sum, e) => sum + (Number(e.monthly_value) || 0), 0);

  // Rateio por hora
  const overheadCalc = calculateOverheadAllocation(monthlyTotal, billableHours, 1);

  const handleOpenNew = () => {
    setEditingItem({
      name: '',
      category: 'Infraestrutura',
      monthly_value: 300,
      accounting_method: 'overhead_allocated',
      notes: '',
      is_active: 1,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: RecurringExpense) => {
    setEditingItem({ ...item });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingItem.name) return;

    try {
      setIsSubmitting(true);
      await onSaveExpense(editingItem);
      setIsModalOpen(false);
      setEditingItem(null);
    } catch (err: any) {
      alert(`Erro ao salvar custo fixo: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Deseja remover "${name}" dos custos fixos mensais?`)) {
      try {
        await onDeleteExpense(id);
      } catch (err: any) {
        alert(`Erro ao excluir: ${err.message}`);
      }
    }
  };

  const handleSaveBillableHours = async () => {
    try {
      await onUpdateSettings({ default_billable_hours_month: billableHours });
      setIsEditingSettings(false);
    } catch (err: any) {
      alert(`Erro ao atualizar horas faturáveis: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Custos Fixos Mensais &amp; Rateio</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Despesas operacionais recorrentes da produtora distribuídas por hora faturável nos orçamentos
          </p>
        </div>

        <button
          onClick={handleOpenNew}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Despesa Fixa</span>
        </button>
      </div>

      {/* Cards de Resumo e Horas Faturáveis */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Total Mensal de Custos Fixos */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <span className="text-xs font-medium text-slate-500">Total Mensal Ativo</span>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono tabular-nums">
            {formatBRL(monthlyTotal)}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Soma de {activeExpenses.length} despesa(s) recorrente(s) ativas
          </p>
        </div>

        {/* Card 2: Horas Faturáveis Previstas por Mês */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Horas Faturáveis / Mês</span>
            {!isEditingSettings && (
              <button
                onClick={() => setIsEditingSettings(true)}
                className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold"
              >
                Ajustar
              </button>
            )}
          </div>

          {isEditingSettings ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min="1"
                value={billableHours}
                onChange={(e) => setBillableHours(parseFloat(e.target.value) || 0)}
                className="w-24 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-700"
              />
              <button
                onClick={handleSaveBillableHours}
                className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800"
              >
                Salvar
              </button>
              <button
                onClick={() => {
                  setBillableHours(settings?.default_billable_hours_month || 100);
                  setIsEditingSettings(false);
                }}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono tabular-nums">
              {billableHours}h <span className="text-xs font-normal text-slate-500">previstas</span>
            </div>
          )}
          <p className="text-xs text-slate-400 mt-2">
            Capacidade produtiva real estimada por mês
          </p>
        </div>

        {/* Card 3: Taxa de Custo Fixo por Hora */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <span className="text-xs font-medium text-slate-500">Custo Fixo por Hora Rateada</span>
          <div className="text-2xl font-bold text-emerald-700 mt-1 font-mono tabular-nums">
            {overheadCalc.isValid ? (
              `R$ ${overheadCalc.hourlyOverhead.toFixed(2)}/h`
            ) : (
              <span className="text-sm text-red-600">Erro no cálculo</span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Valor agregado a cada hora do profissional elegível
          </p>
        </div>
      </div>

      {billableHours <= 0 && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-800 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span>
            Horas faturáveis previstas estão zeradas. O rateio de custos fixos está bloqueado para evitar divisão por zero.
          </span>
        </div>
      )}

      {/* Lista de Despesas Recorrentes */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Despesas Recorrentes Cadastradas</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Assinaturas estruturais, contabilidade, energia e seguros da produtora
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/75 border-b border-slate-100 text-xs font-medium text-slate-500">
              <tr>
                <th className="py-3 px-6">Despesa</th>
                <th className="py-3 px-6">Categoria</th>
                <th className="py-3 px-6">Valor Mensal</th>
                <th className="py-3 px-6">Método de Aplicação</th>
                <th className="py-3 px-6">Status</th>
                <th className="py-3 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-3.5 px-6 font-semibold text-slate-900">{item.name}</td>
                  <td className="py-3.5 px-6 text-xs text-slate-600">{item.category}</td>
                  <td className="py-3.5 px-6 font-mono font-medium text-slate-800 tabular-nums">
                    {formatBRL(item.monthly_value)}
                  </td>
                  <td className="py-3.5 px-6 text-xs text-slate-500">
                    {item.accounting_method === 'overhead_allocated'
                      ? 'Rateado nas horas faturáveis'
                      : 'Cobrado direto em projeto'}
                  </td>
                  <td className="py-3.5 px-6">
                    {item.is_active ? (
                      <span className="text-xs font-medium text-emerald-700">Ativo</span>
                    ) : (
                      <span className="text-xs font-medium text-slate-400">Inativo</span>
                    )}
                  </td>
                  <td className="py-3.5 px-6 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenEdit(item)}
                        title="Editar"
                        className="p-1.5 text-slate-400 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id, item.name)}
                        title="Excluir"
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Criar/Editar Despesa */}
      {isModalOpen && editingItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-4">
              {editingItem.id ? 'Editar Despesa Fixa' : 'Nova Despesa Fixa'}
            </h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome da Despesa *
                </label>
                <input
                  type="text"
                  required
                  value={editingItem.name || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                  placeholder="Ex: Internet Fibra Óptica 1Gbps"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Categoria
                  </label>
                  <input
                    type="text"
                    value={editingItem.category || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                    placeholder="Ex: Conectividade"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Valor Mensal (R$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={editingItem.monthly_value ?? ''}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, monthly_value: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Método de Contabilização
                </label>
                <select
                  value={editingItem.accounting_method || 'overhead_allocated'}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      accounting_method: e.target.value as any,
                    })
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                >
                  <option value="overhead_allocated">Incluída nos custos fixos rateados</option>
                  <option value="direct_project">Cobrada diretamente no projeto</option>
                  <option value="none">Não aplicada a projetos</option>
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="rec_active"
                  checked={editingItem.is_active === 1}
                  onChange={(e) => setEditingItem({ ...editingItem, is_active: e.target.checked ? 1 : 0 })}
                  className="rounded text-emerald-700 focus:ring-emerald-700"
                />
                <label htmlFor="rec_active" className="text-xs text-slate-700 font-medium">
                  Despesa ativa no cálculo do rateio mensal
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50 transition-colors shadow-xs"
                >
                  {isSubmitting ? 'Salvando...' : 'Salvar Despesa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
