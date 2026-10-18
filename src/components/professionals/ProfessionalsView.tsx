import React, { useState } from 'react';
import { Plus, Users2, Edit2, Trash2, Search, Phone } from 'lucide-react';
import { Professional } from '../../types';
import { formatBRL } from '../../financial/engine';

interface ProfessionalsViewProps {
  professionals: Professional[];
  onSaveProfessional: (data: Partial<Professional>) => Promise<void>;
  onDeleteProfessional: (id: string) => Promise<void>;
}

const SPECIALTIES = [
  'Todas',
  'Assistente de câmera',
  'Segundo videomaker',
  'Operador de áudio',
  'Operador de iluminação',
  'Operador de drone',
  'Fotógrafo',
  'Colorista',
  'Editor',
  'Motion designer',
  'Produtor',
  'Outros',
];

export const ProfessionalsView: React.FC<ProfessionalsViewProps> = ({
  professionals,
  onSaveProfessional,
  onDeleteProfessional,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('Todas');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<Professional> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filtered = professionals.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.specialty.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSpecialty =
      selectedSpecialty === 'Todas' || p.specialty === selectedSpecialty;
    return matchesSearch && matchesSpecialty;
  });

  const handleOpenNew = () => {
    setEditingItem({
      name: '',
      specialty: 'Assistente de câmera',
      phone: '',
      email: '',
      hiring_type: 'daily',
      default_value: 600,
      notes: '',
      is_active: 1,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: Professional) => {
    setEditingItem({ ...item });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingItem.name) return;

    try {
      setIsSubmitting(true);
      await onSaveProfessional(editingItem);
      setIsModalOpen(false);
      setEditingItem(null);
    } catch (err: any) {
      alert(`Erro ao salvar: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Deseja arquivar o profissional "${name}"? Os orçamentos passados preservarão o histórico intacto.`)) {
      try {
        await onDeleteProfessional(id);
      } catch (err: any) {
        alert(`Erro ao arquivar: ${err.message}`);
      }
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Equipe &amp; Terceirizados</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Cadastro de assistentes, técnicos de áudio, drone, coloristas e editores parceiros
          </p>
        </div>

        <button
          onClick={handleOpenNew}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Cadastrar Profissional</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4 shadow-xs">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nome ou especialidade..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-700 focus:bg-white"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <label htmlFor="specialtyFilter" className="text-xs text-slate-500 shrink-0">
            Especialidade:
          </label>
          <select
            id="specialtyFilter"
            value={selectedSpecialty}
            onChange={(e) => setSelectedSpecialty(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-700 text-slate-700"
          >
            {SPECIALTIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/75 border-b border-slate-100 text-xs font-medium text-slate-500">
              <tr>
                <th className="py-3 px-6">Profissional</th>
                <th className="py-3 px-6">Especialidade</th>
                <th className="py-3 px-6">Modalidade</th>
                <th className="py-3 px-6">Valor Padrão</th>
                <th className="py-3 px-6">Contato</th>
                <th className="py-3 px-6">Status</th>
                <th className="py-3 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-3.5 px-6 font-semibold text-slate-900">{item.name}</td>
                  <td className="py-3.5 px-6 text-xs text-slate-600">{item.specialty}</td>
                  <td className="py-3.5 px-6 text-xs text-slate-500">
                    {item.hiring_type === 'hourly'
                      ? 'Por hora'
                      : item.hiring_type === 'daily'
                      ? 'Por diária'
                      : 'Valor fechado'}
                  </td>
                  <td className="py-3.5 px-6 font-mono font-medium text-slate-800 tabular-nums">
                    {formatBRL(item.default_value)}
                    <span className="text-[11px] text-slate-400 font-sans ml-1">
                      {item.hiring_type === 'hourly' ? '/h' : item.hiring_type === 'daily' ? '/diária' : ''}
                    </span>
                  </td>
                  <td className="py-3.5 px-6 text-xs text-slate-500 font-mono">
                    {item.phone || item.email || '—'}
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

      {/* Modal */}
      {isModalOpen && editingItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-4">
              {editingItem.id ? 'Editar Profissional' : 'Novo Profissional'}
            </h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  value={editingItem.name || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                  placeholder="Ex: Carlos Mendes"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Especialidade
                  </label>
                  <select
                    value={editingItem.specialty || 'Assistente de câmera'}
                    onChange={(e) => setEditingItem({ ...editingItem, specialty: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  >
                    {SPECIALTIES.filter((s) => s !== 'Todas').map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tipo de Contratação
                  </label>
                  <select
                    value={editingItem.hiring_type || 'daily'}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, hiring_type: e.target.value as any })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  >
                    <option value="daily">Por diária</option>
                    <option value="hourly">Por hora</option>
                    <option value="fixed">Valor fechado</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
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

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Telefone / WhatsApp
                  </label>
                  <input
                    type="text"
                    value={editingItem.phone || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, phone: e.target.value })}
                    placeholder="(11) 99999-9999"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  E-mail
                </label>
                <input
                  type="email"
                  value={editingItem.email || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, email: e.target.value })}
                  placeholder="profissional@email.com"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="pro_active"
                  checked={editingItem.is_active === 1}
                  onChange={(e) => setEditingItem({ ...editingItem, is_active: e.target.checked ? 1 : 0 })}
                  className="rounded text-emerald-700 focus:ring-emerald-700"
                />
                <label htmlFor="pro_active" className="text-xs text-slate-700 font-medium">
                  Profissional ativo para alocação em orçamentos
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
                  {isSubmitting ? 'Salvando...' : 'Salvar Profissional'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
