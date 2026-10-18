import React, { useState } from 'react';
import { Plus, Sparkles, Edit2, Trash2, Search } from 'lucide-react';
import { ExpenseCatalogItem } from '../../types';
import { formatBRL } from '../../financial/engine';

interface ExpenseCatalogViewProps {
  catalog: ExpenseCatalogItem[];
  onSaveItem: (data: Partial<ExpenseCatalogItem>) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
}

export const ExpenseCatalogView: React.FC<ExpenseCatalogViewProps> = ({
  catalog,
  onSaveItem,
  onDeleteItem,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<ExpenseCatalogItem> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filtered = catalog.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleOpenNew = () => {
    setEditingItem({
      name: '',
      category: 'Licenças',
      description: '',
      cost_type: 'per_project',
      default_value: 150,
      periodicity: 'project',
      accounting_method: 'direct_project',
      notes: '',
      is_active: 1,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: ExpenseCatalogItem) => {
    setEditingItem({ ...item });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingItem.name) return;

    try {
      setIsSubmitting(true);
      await onSaveItem(editingItem);
      setIsModalOpen(false);
      setEditingItem(null);
    } catch (err: any) {
      alert(`Erro ao salvar: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Deseja remover "${name}" do catálogo de serviços e materiais?`)) {
      try {
        await onDeleteItem(id);
      } catch (err: any) {
        alert(`Erro ao excluir: ${err.message}`);
      }
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Assinaturas, Serviços &amp; Materiais</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Biblioteca de custos diretos: trilhas sonoras, alimentação, transporte, SSDs e insumos de produção
          </p>
        </div>

        <button
          onClick={handleOpenNew}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Item no Catálogo</span>
        </button>
      </div>

      {/* Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nome ou categoria..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-700 focus:bg-white"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/75 border-b border-slate-100 text-xs font-medium text-slate-500">
              <tr>
                <th className="py-3 px-6">Item / Descrição</th>
                <th className="py-3 px-6">Categoria</th>
                <th className="py-3 px-6">Tipo de Aplicação</th>
                <th className="py-3 px-6">Valor Padrão</th>
                <th className="py-3 px-6">Status</th>
                <th className="py-3 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-3.5 px-6">
                    <div className="font-semibold text-slate-900">{item.name}</div>
                    {item.description && (
                      <div className="text-xs text-slate-400">{item.description}</div>
                    )}
                  </td>
                  <td className="py-3.5 px-6 text-xs text-slate-600">{item.category}</td>
                  <td className="py-3.5 px-6 text-xs text-slate-500">
                    {item.cost_type === 'per_project'
                      ? 'Fixo por projeto'
                      : item.cost_type === 'per_unit'
                      ? 'Unitário × quantidade'
                      : 'Mensal rateado'}
                  </td>
                  <td className="py-3.5 px-6 font-mono font-medium text-slate-800 tabular-nums">
                    {formatBRL(item.default_value)}
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

      {/* Modal Criar/Editar Item */}
      {isModalOpen && editingItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-4">
              {editingItem.id ? 'Editar Item do Catálogo' : 'Novo Item do Catálogo'}
            </h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome do Item / Serviço *
                </label>
                <input
                  type="text"
                  required
                  value={editingItem.name || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                  placeholder="Ex: Trilha Sonora Comercial Licenciada"
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
                    placeholder="Ex: Licenças"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Valor Padrão (R$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={editingItem.default_value ?? ''}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, default_value: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tipo de Custo
                </label>
                <select
                  value={editingItem.cost_type || 'per_project'}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, cost_type: e.target.value as any })
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                >
                  <option value="per_project">Valor específico por projeto (fechado)</option>
                  <option value="per_unit">Despesa unitária multiplicada por quantidade</option>
                  <option value="monthly_allocated">Despesa mensal convertida/rateada</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Descrição
                </label>
                <textarea
                  rows={2}
                  value={editingItem.description || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                  placeholder="Detalhes sobre a licença ou insumo..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="cat_active"
                  checked={editingItem.is_active === 1}
                  onChange={(e) => setEditingItem({ ...editingItem, is_active: e.target.checked ? 1 : 0 })}
                  className="rounded text-emerald-700 focus:ring-emerald-700"
                />
                <label htmlFor="cat_active" className="text-xs text-slate-700 font-medium">
                  Item ativo para uso em novos orçamentos
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
                  {isSubmitting ? 'Salvando...' : 'Salvar Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
