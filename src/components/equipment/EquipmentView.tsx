import React, { useState } from 'react';
import { Plus, Search, Camera, Edit2, Trash2, CheckCircle, XCircle, Copy, AlertCircle } from 'lucide-react';
import { Equipment } from '../../types';
import { calculateEquipmentDepreciation, formatBRL } from '../../financial/engine';

interface EquipmentViewProps {
  equipmentList: Equipment[];
  onSave: (data: Partial<Equipment>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export const CATEGORIES = [
  'Todas',
  'Câmeras',
  'Lentes',
  'Iluminação',
  'Áudio',
  'Estabilização',
  'Suportes e rigging',
  'Tripés',
  'Baterias',
  'Cartões e armazenamento',
  'Computadores',
  'Monitores',
  'Acessórios',
  'Outros',
];

export const normalizeEquipmentName = (name: string): string => {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
};

export const EquipmentView: React.FC<EquipmentViewProps> = ({
  equipmentList,
  onSave,
  onDelete,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<Equipment> | null>(null);
  const [duplicatedFrom, setDuplicatedFrom] = useState<Equipment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = equipmentList.filter((eq) => {
    const matchesSearch =
      eq.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      eq.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
      eq.model.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory =
      selectedCategory === 'Todas' || eq.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleOpenNew = () => {
    setEditingItem({
      name: '',
      category: 'Câmeras',
      brand: '',
      model: '',
      serial_number: '',
      purchase_value: 10000,
      residual_value: 1000,
      useful_life_years: 3,
      estimation_method: 'total_hours',
      total_useful_hours: 3000,
      annual_hours: 600,
      notes: '',
      is_active: 1,
    });
    setDuplicatedFrom(null);
    setFormError(null);
    setIsEditing(true);
    setFeedback(null);
  };

  const handleOpenEdit = (item: Equipment) => {
    setEditingItem({ ...item });
    setDuplicatedFrom(null);
    setFormError(null);
    setIsEditing(true);
    setFeedback(null);
  };

  const handleDuplicate = (item: Equipment) => {
    // Cria novo cadastro com identificador próprio (sem reutilizar o ID do original)
    // Preserva parâmetros técnicos e financeiros, exigindo nome próprio e exclusivo
    setEditingItem({
      name: '', // Nome deve ser obrigatório e diferente do original
      category: item.category,
      brand: item.brand,
      model: item.model,
      serial_number: '', // Número de série da nova unidade física
      purchase_value: item.purchase_value,
      residual_value: item.residual_value,
      useful_life_years: item.useful_life_years,
      estimation_method: item.estimation_method,
      total_useful_hours: item.total_useful_hours,
      annual_hours: item.annual_hours,
      notes: item.notes,
      is_active: item.is_active,
    });
    setDuplicatedFrom(item);
    setFormError(null);
    setIsEditing(true);
    setFeedback(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!editingItem) return;

    const rawName = editingItem.name || '';
    const trimmedName = rawName.trim();

    // 1. Nome obrigatório
    if (!trimmedName) {
      setFormError('O nome do equipamento é obrigatório.');
      return;
    }

    // 2. Se for duplicata, o nome deve ser diferente do equipamento de origem
    if (duplicatedFrom && normalizeEquipmentName(trimmedName) === normalizeEquipmentName(duplicatedFrom.name)) {
      setFormError(`O nome do novo equipamento deve ser diferente do equipamento de origem ("${duplicatedFrom.name}"). Digite uma identificação exclusiva para esta nova unidade.`);
      return;
    }

    // 3. Impedir nomes duplicados entre equipamentos cadastrados (normalização de espaços e case-insensitive)
    const isDuplicate = equipmentList.some((eq) => {
      if (editingItem.id && eq.id === editingItem.id) return false;
      return normalizeEquipmentName(eq.name) === normalizeEquipmentName(trimmedName);
    });

    if (isDuplicate) {
      setFormError(`Já existe um equipamento cadastrado com o nome "${trimmedName}". Cada equipamento deve ter um nome exclusivo.`);
      return;
    }

    try {
      setIsSubmitting(true);
      await onSave({
        ...editingItem,
        name: trimmedName,
      });
      setIsEditing(false);
      setEditingItem(null);
      setDuplicatedFrom(null);
      setFeedback(duplicatedFrom ? 'Equipamento duplicado e cadastrado com sucesso.' : 'Equipamento salvo com sucesso.');
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFormError(err.message || 'Erro ao salvar equipamento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Deseja realmente arquivar o equipamento "${name}"? Os orçamentos históricos que já utilizam este item não serão alterados.`)) {
      try {
        await onDelete(id);
      } catch (err: any) {
        alert(`Erro ao arquivar: ${err.message}`);
      }
    }
  };

  // Depreciação em tempo real para o formulário
  const previewDepreciation = editingItem
    ? calculateEquipmentDepreciation({
        purchaseValue: Number(editingItem.purchase_value) || 0,
        residualValue: Number(editingItem.residual_value) || 0,
        method: editingItem.estimation_method || 'total_hours',
        totalUsefulHours: Number(editingItem.total_useful_hours) || 0,
        annualHours: Number(editingItem.annual_hours) || 0,
        usefulYears: Number(editingItem.useful_life_years) || 0,
      })
    : null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Biblioteca de Equipamentos</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Cadastro de patrimônio técnico com taxa de depreciação por hora de uso em projetos
          </p>
        </div>

        <button
          onClick={handleOpenNew}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Cadastrar Equipamento</span>
        </button>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">
          {feedback}
        </div>
      )}

      {/* Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4 shadow-xs">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nome, marca ou modelo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-700 focus:bg-white"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <label htmlFor="categoryFilter" className="text-xs text-slate-500 shrink-0">
            Categoria:
          </label>
          <select
            id="categoryFilter"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-700 text-slate-700"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Equipment Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            Nenhum equipamento encontrado com os filtros selecionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/75 border-b border-slate-100 text-xs font-medium text-slate-500">
                <tr>
                  <th className="py-3 px-6">Equipamento</th>
                  <th className="py-3 px-6">Categoria</th>
                  <th className="py-3 px-6">Valor de Compra</th>
                  <th className="py-3 px-6">Valor Residual</th>
                  <th className="py-3 px-6">Horas Úteis</th>
                  <th className="py-3 px-6">Depreciação/Hora</th>
                  <th className="py-3 px-6">Status</th>
                  <th className="py-3 px-6 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => {
                  const dep = calculateEquipmentDepreciation({
                    purchaseValue: item.purchase_value,
                    residualValue: item.residual_value,
                    method: item.estimation_method,
                    totalUsefulHours: item.total_useful_hours,
                    annualHours: item.annual_hours,
                    usefulYears: item.useful_life_years,
                  });

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-6">
                        <div className="font-semibold text-slate-900">{item.name}</div>
                        <div className="text-xs text-slate-400">
                          {[item.brand, item.model].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="py-3.5 px-6 text-xs text-slate-600">{item.category}</td>
                      <td className="py-3.5 px-6 font-mono text-slate-700 tabular-nums">
                        {formatBRL(item.purchase_value)}
                      </td>
                      <td className="py-3.5 px-6 font-mono text-slate-500 tabular-nums">
                        {formatBRL(item.residual_value)}
                      </td>
                      <td className="py-3.5 px-6 font-mono text-slate-700 tabular-nums">
                        {dep.totalUsefulHours}h
                      </td>
                      <td className="py-3.5 px-6 font-mono font-semibold text-emerald-700 tabular-nums">
                        {dep.isValid ? (
                          `R$ ${dep.hourlyDepreciation.toFixed(2)}/h`
                        ) : (
                          <span className="text-xs text-red-600 font-sans">Inválido</span>
                        )}
                      </td>
                      <td className="py-3.5 px-6">
                        {item.is_active ? (
                          <span className="text-xs text-emerald-700 font-medium">Ativo</span>
                        ) : (
                          <span className="text-xs text-slate-400 font-medium">Inativo</span>
                        )}
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleDuplicate(item)}
                            title="Duplicar equipamento"
                            aria-label={`Duplicar equipamento ${item.name}`}
                            className="p-1.5 text-slate-400 hover:text-emerald-700 rounded-md hover:bg-emerald-50 transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(item)}
                            title="Editar"
                            aria-label={`Editar equipamento ${item.name}`}
                            className="p-1.5 text-slate-400 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id, item.name)}
                            title="Arquivar"
                            aria-label={`Arquivar equipamento ${item.name}`}
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

      {/* Modal / Slide-in para Criação e Edição */}
      {isEditing && editingItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 sm:p-8 max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {duplicatedFrom ? 'Duplicar Equipamento' : editingItem.id ? 'Editar Equipamento' : 'Novo Equipamento'}
                </h3>
                <p className="text-xs text-slate-500">
                  {duplicatedFrom
                    ? `Criando nova unidade a partir de "${duplicatedFrom.name}". Informe um nome exclusivo e ajuste os parâmetros se necessário.`
                    : 'Configure o custo de aquisição e a regra de depreciação por hora'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setDuplicatedFrom(null);
                  setFormError(null);
                }}
                className="text-slate-400 hover:text-slate-600 text-sm font-medium"
              >
                Cancelar
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-xs text-red-700">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1 font-medium">{formError}</div>
              </div>
            )}

            {duplicatedFrom && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-800">
                <div className="flex items-center gap-2">
                  <Copy className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Duplicando a partir de: <strong>{duplicatedFrom.name}</strong> ({duplicatedFrom.category})
                  </span>
                </div>
                <span className="text-[11px] text-emerald-600 font-medium">Novo ID será gerado</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nome do Equipamento *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingItem.name || ''}
                    onChange={(e) => {
                      setEditingItem({ ...editingItem, name: e.target.value });
                      if (formError) setFormError(null);
                    }}
                    placeholder={
                      duplicatedFrom
                        ? `Ex: ${duplicatedFrom.name} 02`
                        : "Ex: Cinema Camera Sony FX3"
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  />
                  {duplicatedFrom && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      O nome deve ser obrigatório, exclusivo e diferente de "{duplicatedFrom.name}".
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Categoria *
                  </label>
                  <select
                    value={editingItem.category || 'Câmeras'}
                    onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  >
                    {CATEGORIES.filter((c) => c !== 'Todas').map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Marca
                  </label>
                  <input
                    type="text"
                    value={editingItem.brand || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, brand: e.target.value })}
                    placeholder="Ex: Sony"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Modelo
                  </label>
                  <input
                    type="text"
                    value={editingItem.model || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, model: e.target.value })}
                    placeholder="Ex: ILME-FX3"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Número de Série
                  </label>
                  <input
                    type="text"
                    value={editingItem.serial_number || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, serial_number: e.target.value })}
                    placeholder="Opcional"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  />
                </div>
              </div>

              {/* Seção Financeira e Depreciação */}
              <div className="pt-4 border-t border-slate-100">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                  Parâmetros de Depreciação
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Valor de Compra (R$) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={editingItem.purchase_value ?? ''}
                      onChange={(e) =>
                        setEditingItem({ ...editingItem, purchase_value: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Valor Residual Estimado (R$)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editingItem.residual_value ?? ''}
                      onChange={(e) =>
                        setEditingItem({ ...editingItem, residual_value: parseFloat(e.target.value) || 0 })
                      }
                      placeholder="Padrão 0 se não informado"
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Método de Estimativa de Horas
                    </label>
                    <select
                      value={editingItem.estimation_method || 'total_hours'}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          estimation_method: e.target.value as 'total_hours' | 'annual_hours',
                        })
                      }
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                    >
                      <option value="total_hours">Método A: Horas totais na vida útil</option>
                      <option value="annual_hours">Método B: Horas anuais × anos de vida útil</option>
                    </select>
                  </div>

                  {editingItem.estimation_method === 'total_hours' ? (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Horas Úteis Totais *
                      </label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={editingItem.total_useful_hours ?? ''}
                        onChange={(e) =>
                          setEditingItem({
                            ...editingItem,
                            total_useful_hours: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Horas de Uso por Ano *
                        </label>
                        <input
                          type="number"
                          min="1"
                          required
                          value={editingItem.annual_hours ?? ''}
                          onChange={(e) =>
                            setEditingItem({
                              ...editingItem,
                              annual_hours: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Vida Útil Estimada (Anos) *
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          required
                          value={editingItem.useful_life_years ?? ''}
                          onChange={(e) =>
                            setEditingItem({
                              ...editingItem,
                              useful_life_years: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Resultado da Depreciação Calculada em Tempo Real */}
                <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">Depreciação por Hora Resultante:</span>
                    {previewDepreciation?.isValid ? (
                      <span className="font-mono font-bold text-sm text-emerald-700 tabular-nums">
                        R$ {previewDepreciation.hourlyDepreciation.toFixed(2)}/h
                      </span>
                    ) : (
                      <span className="text-red-600 font-medium">
                        {previewDepreciation?.errorMessage || 'Parâmetros inválidos'}
                      </span>
                    )}
                  </div>
                  {previewDepreciation?.isValid && (
                    <div className="text-[11px] text-slate-500 mt-1">
                      Horas totais de vida útil consideradas: {previewDepreciation.totalUsefulHours}h · Valor depreciável: {formatBRL((Number(editingItem.purchase_value) || 0) - (Number(editingItem.residual_value) || 0))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Observações
                </label>
                <textarea
                  rows={2}
                  value={editingItem.notes || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, notes: e.target.value })}
                  placeholder="Informações de garantia, acessórios inclusos..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="item_is_active"
                  checked={editingItem.is_active === 1}
                  onChange={(e) => setEditingItem({ ...editingItem, is_active: e.target.checked ? 1 : 0 })}
                  className="rounded text-emerald-700 focus:ring-emerald-700"
                />
                <label htmlFor="item_is_active" className="text-xs text-slate-700 font-medium">
                  Equipamento ativo para seleção em novos orçamentos
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setDuplicatedFrom(null);
                    setFormError(null);
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !previewDepreciation?.isValid}
                  className="px-5 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50 transition-colors shadow-xs"
                >
                  {isSubmitting
                    ? 'Salvando...'
                    : duplicatedFrom
                    ? 'Salvar Duplicata'
                    : editingItem.id
                    ? 'Atualizar Equipamento'
                    : 'Salvar Equipamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
