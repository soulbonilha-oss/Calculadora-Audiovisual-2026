import React from 'react';
import {
  LayoutDashboard,
  FilePlus2,
  FolderKanban,
  Camera,
  Coins,
  Sparkles,
  Users2,
  Boxes,
  SlidersHorizontal,
  DatabaseBackup,
  X,
} from 'lucide-react';
import { StudioSettings } from '../../types';

export type ActiveView =
  | 'dashboard'
  | 'new_budget'
  | 'budget_editor'
  | 'budgets_list'
  | 'equipment'
  | 'fixed_expenses'
  | 'catalog'
  | 'professionals'
  | 'templates'
  | 'settings'
  | 'backup';

interface SidebarProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
  settings: StudioSettings | null;
  savedBudgetsCount?: number;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onNavigate,
  settings,
  savedBudgetsCount = 0,
  isOpenMobile = false,
  onCloseMobile,
}) => {
  const navItems = [
    { id: 'dashboard' as ActiveView, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'new_budget' as ActiveView, label: 'Novo Orçamento', icon: FilePlus2, highlight: true },
    { id: 'budgets_list' as ActiveView, label: 'Orçamentos Salvos', icon: FolderKanban, badge: savedBudgetsCount },
    { id: 'equipment' as ActiveView, label: 'Equipamentos', icon: Camera },
    { id: 'fixed_expenses' as ActiveView, label: 'Custos Fixos & Horas', icon: Coins },
    { id: 'catalog' as ActiveView, label: 'Assinaturas & Materiais', icon: Sparkles },
    { id: 'professionals' as ActiveView, label: 'Equipe & Terceiros', icon: Users2 },
    { id: 'templates' as ActiveView, label: 'Modelos de Produção', icon: Boxes },
    { id: 'settings' as ActiveView, label: 'Configurações', icon: SlidersHorizontal },
    { id: 'backup' as ActiveView, label: 'Backup & Restauração', icon: DatabaseBackup },
  ];

  const handleItemClick = (id: ActiveView) => {
    onNavigate(id);
    if (onCloseMobile) onCloseMobile();
  };

  const content = (
    <div className="w-64 bg-white border-r border-slate-200 flex flex-col h-full">
      {/* Studio Brand Header */}
      <div className="p-6 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold text-sm tracking-tight shadow-xs shrink-0">
            FB
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900 tracking-tight truncate">
              {settings?.studio_name || 'FBonilha'}
            </h1>
            <p className="text-xs text-slate-500 truncate">Audiovisual &amp; Precificação</p>
          </div>
        </div>

        {onCloseMobile && (
          <button
            onClick={onCloseMobile}
            className="lg:hidden p-1 text-slate-400 hover:text-slate-700 rounded-md"
            aria-label="Fechar navegação"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Navegação Principal">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeView === item.id ||
            (item.id === 'budgets_list' && activeView === 'budget_editor');

          if (item.highlight) {
            return (
              <button
                key={item.id}
                onClick={() => handleItemClick(item.id)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 my-1.5 rounded-lg text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 transition-colors shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </div>
              </button>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => handleItemClick(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-slate-100 text-slate-900 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`w-4 h-4 ${
                    isActive ? 'text-emerald-700' : 'text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </div>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="text-xs text-slate-500 tabular-nums">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Studio Info Footnote */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/50">
        <div className="text-xs text-slate-500 space-y-1">
          <div className="flex items-center justify-between">
            <span>Hora Base</span>
            <span className="font-semibold text-slate-700 tabular-nums">
              R$ {Number(settings?.default_hourly_rate || 150).toFixed(2)}/h
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Faturáveis/mês</span>
            <span className="font-semibold text-slate-700 tabular-nums">
              {settings?.default_billable_hours_month || 100}h
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 h-screen sticky top-0">
        {content}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isOpenMobile && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white z-50 shadow-2xl">
            {content}
          </div>
        </div>
      )}
    </>
  );
};
