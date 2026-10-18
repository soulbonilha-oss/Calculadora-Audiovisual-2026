import React, { useState } from 'react';
import { Plus, Boxes, Copy, Edit2, Trash2, ArrowRight, Clock, Camera, Users2 } from 'lucide-react';
import { ProductionTemplate } from '../../types';

interface TemplatesViewProps {
  templates: ProductionTemplate[];
  onUseTemplate: (template: ProductionTemplate) => void;
  onCloneTemplate: (id: string) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
}

export const TemplatesView: React.FC<TemplatesViewProps> = ({
  templates,
  onUseTemplate,
  onCloneTemplate,
  onDeleteTemplate,
}) => {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleClone = async (id: string) => {
    try {
      await onCloneTemplate(id);
      setFeedback('Modelo duplicado com sucesso.');
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      alert(`Erro ao duplicar: ${err.message}`);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Deseja remover o modelo "${name}"? Os orçamentos existentes criados a partir dele não serão afetados.`)) {
      try {
        await onDeleteTemplate(id);
        setFeedback('Modelo removido com sucesso.');
        setTimeout(() => setFeedback(null), 3000);
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
          <h2 className="text-xl font-bold text-slate-900">Modelos de Produção Reutilizáveis</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Estruturas pré-definidas de etapas, equipamentos, equipe e margens para agilizar a criação de orçamentos
          </p>
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium">
          {feedback}
        </div>
      )}

      {/* Grid de Modelos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {templates.map((tpl) => {
          const totalHours = (tpl.stages || []).reduce(
            (sum, s) => sum + (Number(s.hours) || 0),
            0
          );
          const equipmentCount = (tpl.equipment || []).length;
          const crewCount = (tpl.professionals || []).length;

          return (
            <div
              key={tpl.id}
              className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between hover:border-slate-300 transition-colors shadow-xs"
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{tpl.name}</h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      {tpl.description || 'Modelo de fluxo audiovisual customizado.'}
                    </p>
                  </div>
                </div>

                {/* Métricas do Modelo */}
                <div className="flex items-center gap-4 text-xs text-slate-500 mt-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-1.5 font-medium text-slate-700">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{totalHours.toFixed(1)}h estimadas</span>
                  </div>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <div className="flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-slate-400" />
                    <span>{equipmentCount} equipamentos</span>
                  </div>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <div className="flex items-center gap-1.5">
                    <Users2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>{crewCount} profissionais</span>
                  </div>
                </div>

                {/* Lista resumida de etapas */}
                <div className="mt-4 space-y-1.5">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Etapas Pré-configuradas:
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(tpl.stages || []).slice(0, 4).map((s, idx) => (
                      <span
                        key={idx}
                        className="text-xs text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded"
                      >
                        {s.name} ({s.hours}h)
                      </span>
                    ))}
                    {(tpl.stages || []).length > 4 && (
                      <span className="text-xs text-slate-400 self-center">
                        +{(tpl.stages || []).length - 4} etapas
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Ações do Modelo */}
              <div className="flex items-center justify-between pt-6 mt-6 border-t border-slate-100">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleClone(tpl.id)}
                    title="Duplicar modelo"
                    className="p-1.5 text-slate-400 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(tpl.id, tpl.name)}
                    title="Excluir modelo"
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={() => onUseTemplate(tpl)}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs"
                >
                  <span>Criar Orçamento a partir deste Modelo</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
