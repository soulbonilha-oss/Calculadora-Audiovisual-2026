import React from 'react';
import { Plus, Menu } from 'lucide-react';
import { ActiveView } from './Sidebar';

interface HeaderProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
  onOpenMobileMenu?: () => void;
  title?: string;
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onNavigate,
  onOpenMobileMenu,
  title,
}) => {
  const getSectionTitle = () => {
    switch (activeView) {
      case 'dashboard':
        return 'Visão Geral & Indicadores';
      case 'new_budget':
      case 'budget_editor':
        return title || 'Editor de Orçamento Audiovisual';
      case 'budgets_list':
        return 'Orçamentos & Histórico';
      case 'equipment':
        return 'Biblioteca de Equipamentos & Depreciação';
      case 'fixed_expenses':
        return 'Custos Fixos Mensais & Rateio de Horas';
      case 'catalog':
        return 'Assinaturas, Serviços & Materiais Extras';
      case 'professionals':
        return 'Equipe Técnica & Prestadores de Serviço';
      case 'templates':
        return 'Modelos Reutilizáveis de Produção';
      case 'settings':
        return 'Configurações do Estúdio & Parâmetros';
      case 'backup':
        return 'Backup, Restauração & Integridade';
      default:
        return 'FBonilha - Produtora Audiovisual';
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 sm:gap-8 shrink-0 z-10 sticky top-0">
      {/* Zone 1: Mobile Hamburger & Title */}
      <div className="flex items-center gap-3 whitespace-nowrap shrink-0 min-w-0">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          aria-label="Abrir menu de navegação"
        >
          <Menu className="w-5 h-5" />
        </button>

        <h2 className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight truncate">
          {getSectionTitle()}
        </h2>
      </div>

      {/* Zone 2: Navigation Links (Clean unboxed typography) */}
      <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-500">
        <button
          onClick={() => onNavigate('dashboard')}
          className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
            activeView === 'dashboard' ? 'text-slate-900 font-semibold' : ''
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => onNavigate('budgets_list')}
          className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
            activeView === 'budgets_list' ? 'text-slate-900 font-semibold' : ''
          }`}
        >
          Orçamentos
        </button>
        <button
          onClick={() => onNavigate('equipment')}
          className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
            activeView === 'equipment' ? 'text-slate-900 font-semibold' : ''
          }`}
        >
          Equipamentos
        </button>
        <button
          onClick={() => onNavigate('templates')}
          className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
            activeView === 'templates' ? 'text-slate-900 font-semibold' : ''
          }`}
        >
          Modelos
        </button>
      </nav>

      {/* Zone 3: 1 Primary Action */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={() => onNavigate('new_budget')}
          className="flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Novo Orçamento</span>
          <span className="sm:hidden">Novo</span>
        </button>
      </div>
    </header>
  );
};
