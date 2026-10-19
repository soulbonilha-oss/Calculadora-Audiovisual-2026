import React, { useState, useEffect } from 'react';
import { Save, SlidersHorizontal, CheckCircle2 } from 'lucide-react';
import { StudioSettings } from '../../types';

interface SettingsViewProps {
  settings: StudioSettings | null;
  onSaveSettings: (data: Partial<StudioSettings>) => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
}) => {
  const [form, setForm] = useState<Partial<StudioSettings>>(settings || {});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await onSaveSettings(form);
      setFeedback('Configurações salvas com sucesso no banco de dados SQLite.');
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      alert(`Erro ao salvar configurações: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Configurações Gerais do Estúdio</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Parâmetros financeiros padrão, identidade visual e termos das propostas comerciais da FBonilha
        </p>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{feedback}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identidade Visual & Contato */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-4 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider pb-2 border-b border-slate-100">
            Identidade do Estúdio &amp; Contato
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nome da Produtora *
              </label>
              <input
                type="text"
                required
                value={form.studio_name || ''}
                onChange={(e) => setForm({ ...form, studio_name: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                CNPJ
              </label>
              <input
                type="text"
                value={form.cnpj || ''}
                onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                placeholder="00.000.000/0001-00"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Telefone / WhatsApp Comercial
              </label>
              <input
                type="text"
                value={form.phone || ''}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="(11) 98765-4321"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                E-mail Comercial
              </label>
              <input
                type="email"
                value={form.email || ''}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="contato@fbonilha.com.br"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Website / Portfólio
              </label>
              <input
                type="text"
                value={form.website || ''}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="www.fbonilha.com.br"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Cor Principal da Identidade (Hex)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.primary_color || '#059669'}
                  onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                  className="w-8 h-8 rounded border border-slate-200 cursor-pointer"
                />
                <input
                  type="text"
                  value={form.primary_color || '#059669'}
                  onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                  className="w-32 px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Parâmetros Financeiros Padrão */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-4 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider pb-2 border-b border-slate-100">
            Parâmetros Padrão para Novos Orçamentos
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Valor Padrão da Hora Profissional (R$) *
              </label>
              <input
                type="number"
                step="1"
                min="1"
                required
                value={form.default_hourly_rate ?? 150}
                onChange={(e) =>
                  setForm({ ...form, default_hourly_rate: parseFloat(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Horas Faturáveis Previstas / Mês *
              </label>
              <input
                type="number"
                min="1"
                required
                value={form.default_billable_hours_month ?? 100}
                onChange={(e) =>
                  setForm({ ...form, default_billable_hours_month: parseFloat(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Método Padrão de Formação de Preço
              </label>
              <select
                value={form.default_pricing_method || 'margin_on_sale'}
                onChange={(e) => setForm({ ...form, default_pricing_method: e.target.value as any })}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              >
                <option value="margin_on_sale">Margem de lucro sobre a venda</option>
                <option value="markup_on_cost">Acréscimo sobre o custo (markup)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Margem de Lucro Padrão (% sobre venda)
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={form.default_profit_margin_pct !== undefined ? form.default_profit_margin_pct : 25}
                onChange={(e) =>
                  setForm({ ...form, default_profit_margin_pct: e.target.value === '' ? ('' as any) : (isNaN(parseFloat(e.target.value)) ? 0 : parseFloat(e.target.value)) })
                }
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Alíquota de Impostos Padrão (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.default_tax_pct !== undefined ? form.default_tax_pct : 6}
                onChange={(e) =>
                  setForm({ ...form, default_tax_pct: e.target.value === '' ? ('' as any) : (isNaN(parseFloat(e.target.value)) ? 0 : parseFloat(e.target.value)) })
                }
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Taxas Financeiras Padrão (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.default_financial_fee_pct !== undefined ? form.default_financial_fee_pct : 2.5}
                onChange={(e) =>
                  setForm({ ...form, default_financial_fee_pct: e.target.value === '' ? ('' as any) : (isNaN(parseFloat(e.target.value)) ? 0 : parseFloat(e.target.value)) })
                }
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Desconto Padrão À Vista (%)
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={form.default_cash_discount_pct !== undefined ? form.default_cash_discount_pct : 10}
                onChange={(e) =>
                  setForm({ ...form, default_cash_discount_pct: e.target.value === '' ? ('' as any) : (isNaN(parseFloat(e.target.value)) ? 0 : parseFloat(e.target.value)) })
                }
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Validade Padrão da Proposta (Dias corridos)
              </label>
              <input
                type="number"
                min="1"
                value={form.proposal_valid_days ?? 7}
                onChange={(e) =>
                  setForm({ ...form, proposal_valid_days: parseInt(e.target.value) || 7 })
                }
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Termos & Condições Padrão */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-4 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider pb-2 border-b border-slate-100">
            Termos &amp; Condições Padrão da Proposta Comercial
          </h3>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Texto das Condições Comerciais exibidas no PDF
            </label>
            <textarea
              rows={4}
              value={form.terms_and_conditions || ''}
              onChange={(e) => setForm({ ...form, terms_and_conditions: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-emerald-700 focus:outline-none font-mono"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50 transition-colors shadow-xs"
          >
            <Save className="w-4 h-4" />
            <span>{isSubmitting ? 'Salvando...' : 'Salvar Todas as Configurações'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
