import React, { useState } from 'react';
import {
  DatabaseBackup,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileJson,
  Database,
  ShieldCheck,
  Trash2,
  Info,
  X,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../../api/client';

interface BackupViewProps {
  onRefreshAllData: () => Promise<void>;
}

export const BackupView: React.FC<BackupViewProps> = ({ onRefreshAllData }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [demoItems, setDemoItems] = useState<Array<{ table: string; categoryLabel: string; id: string; name: string }>>([]);
  const [loadingDemoItems, setLoadingDemoItems] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewData(null);
      setFeedback(null);
      setErrorMessage(null);

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string;
          const parsed = JSON.parse(content);
          // Fazer preview via backend
          setIsProcessing(true);
          const previewResult = await api.importBackupJson(parsed, 'preview', restoreMode);
          setPreviewData({ ...previewResult, raw: parsed });
        } catch (err: any) {
          setErrorMessage(`Arquivo inválido: ${err.message}`);
        } finally {
          setIsProcessing(false);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleOpenClearDemoModal = async () => {
    setLoadingDemoItems(true);
    setDemoModalOpen(true);
    try {
      const res = await api.listSampleData();
      setDemoItems(res.samples || []);
    } catch (err: any) {
      setErrorMessage(`Erro ao carregar lista de itens de demonstração: ${err.message}`);
    } finally {
      setLoadingDemoItems(false);
    }
  };

  const handleConfirmClearDemo = async () => {
    try {
      setIsProcessing(true);
      const res = await api.clearSampleData();
      setFeedback(res.message);
      setDemoModalOpen(false);
      await onRefreshAllData();
    } catch (err: any) {
      setErrorMessage(`Erro ao remover dados de exemplo: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRestoreDemoData = async () => {
    try {
      setIsProcessing(true);
      const res = await api.restoreSampleData();
      setFeedback(res.message);
      await onRefreshAllData();
    } catch (err: any) {
      setErrorMessage(`Erro ao restaurar dados de exemplo: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteRestore = async () => {
    if (!previewData || !previewData.raw) return;

    const confirmationMessage = restoreMode === 'replace'
      ? 'ATENÇÃO — SUBSTITUIÇÃO INTEGRAL DA BASE:\n\nOs dados atuais do SQLite serão substituídos exatamente pelos registros deste backup.\nQualquer cadastro ou orçamento atual que NÃO conste no arquivo será REMOVIDO.\n\nUm backup de segurança prévio será gerado automaticamente antes da operação.\n\nConfirma a substituição integral?'
      : 'CONFIRMAÇÃO — MESCLAGEM DE DADOS:\n\nOs registros contidos neste backup serão inseridos e atualizados no banco atual.\nCadastros e orçamentos locais que não constem no arquivo serão preservados intactos.\n\nConfirma a mesclagem dos dados?';

    if (confirm(confirmationMessage)) {
      try {
        setIsProcessing(true);
        const res = await api.importBackupJson(previewData.raw, 'commit', restoreMode);
        setFeedback(res.message || 'Banco de dados e histórico de propostas restaurados com sucesso!');
        setPreviewData(null);
        setSelectedFile(null);
        await onRefreshAllData();
      } catch (err: any) {
        setErrorMessage(`Falha na restauração: ${err.message}`);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Backup &amp; Restauração de Dados</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Garantia de segurança, portabilidade e independência dos dados do estúdio FBonilha
        </p>
      </div>

      {feedback && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Exportação */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-4 shadow-xs">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
          <Download className="w-5 h-5 text-emerald-700" />
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Exportar Dados (Backup de Segurança)
            </h3>
            <p className="text-xs text-slate-500">
              Gere cópias de segurança de todo o patrimônio, custos fixos, equipe, modelos, histórico de orçamentos e propostas emitidas
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {/* Opção 1: Backup Lógico JSON */}
          <div className="p-5 border border-slate-200 rounded-xl bg-slate-50/50 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <FileJson className="w-4 h-4 text-emerald-700" />
                <span>Backup Estruturado (JSON)</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Arquivo legível e universal contendo configurações, equipamentos, custos fixos, equipe, modelos, orçamentos e propostas comerciais emitidas.
              </p>
            </div>
            <div className="mt-4">
              <a
                href={api.exportBackupJsonUrl()}
                download
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Baixar Backup JSON</span>
              </a>
            </div>
          </div>

          {/* Opção 2: Banco SQLite Binário via VACUUM INTO */}
          <div className="p-5 border border-slate-200 rounded-xl bg-slate-50/50 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Database className="w-4 h-4 text-slate-700" />
                <span>Snapshot Atômico SQLite (.sqlite)</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Snapshot íntegro gerado via <code>VACUUM INTO</code> do SQLite nativo, incorporando todos os dados em WAL mode sem risco de corrupção.
              </p>
            </div>
            <div className="mt-4">
              <a
                href={api.exportBackupSqliteUrl()}
                download
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Baixar fbonilha.sqlite</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Importação e Restauração Segura */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-4 shadow-xs">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
          <Upload className="w-5 h-5 text-emerald-700" />
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Restauração de Dados
            </h3>
            <p className="text-xs text-slate-500">
              Carregue um arquivo JSON de backup com validação prévia de integridade e transação segura com rollback
            </p>
          </div>
        </div>

        <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl text-center">
          <input
            type="file"
            id="backupFileInput"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />
          <label
            htmlFor="backupFileInput"
            className="cursor-pointer inline-flex flex-col items-center gap-2 text-xs text-slate-600 hover:text-slate-900"
          >
            <Upload className="w-6 h-6 text-slate-400" />
            <span className="font-semibold text-emerald-700">
              Clique aqui para selecionar o arquivo de backup (.json)
            </span>
            <span className="text-slate-400">
              {selectedFile ? selectedFile.name : 'Nenhum arquivo selecionado'}
            </span>
          </label>
        </div>

        {/* Prévia da Restauração */}
        {previewData && (
          <div className="p-5 bg-amber-50/50 border border-amber-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-amber-900">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                <span>Resumo dos Registros no Arquivo ({previewData.app || 'Backup FBonilha'})</span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[11px] ${previewData.valid ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                {previewData.valid ? 'Arquivo Estruturalmente Válido' : 'Arquivo com Inconsistências'}
              </span>
            </div>

            {/* Erros Encontrados */}
            {previewData.errors && previewData.errors.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 space-y-1">
                <p className="font-bold">Erros que impedem a restauração:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {previewData.errors.map((err: string, i: number) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Avisos Encontrados */}
            {previewData.warnings && previewData.warnings.length > 0 && (
              <div className="p-3 bg-amber-100/60 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                <p className="font-bold">Observações de compatibilidade:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {previewData.warnings.map((warn: string, i: number) => (
                    <li key={i}>{warn}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-700">
              <div className="p-2 bg-white rounded border border-slate-200">
                <span className="text-slate-400">Equipamentos:</span>{' '}
                <strong>{previewData.summary?.equipmentCount || 0}</strong>
              </div>
              <div className="p-2 bg-white rounded border border-slate-200">
                <span className="text-slate-400">Custos Fixos:</span>{' '}
                <strong>{previewData.summary?.recurringExpensesCount || 0}</strong>
              </div>
              <div className="p-2 bg-white rounded border border-slate-200">
                <span className="text-slate-400">Catálogo:</span>{' '}
                <strong>{previewData.summary?.catalogCount || 0}</strong>
              </div>
              <div className="p-2 bg-white rounded border border-slate-200">
                <span className="text-slate-400">Profissionais:</span>{' '}
                <strong>{previewData.summary?.professionalsCount || 0}</strong>
              </div>
              <div className="p-2 bg-white rounded border border-slate-200">
                <span className="text-slate-400">Modelos:</span>{' '}
                <strong>{previewData.summary?.templatesCount || 0}</strong>
              </div>
              <div className="p-2 bg-white rounded border border-slate-200">
                <span className="text-slate-400">Orçamentos:</span>{' '}
                <strong>{previewData.summary?.budgetsCount || 0}</strong>
              </div>
              <div className="p-2 bg-white rounded border border-slate-200">
                <span className="text-slate-400">Propostas:</span>{' '}
                <strong>{previewData.summary?.proposalsCount || 0}</strong>
              </div>
            </div>

            {/* Seletor Explícito de Modalidade de Restauração */}
            <div className="pt-2 border-t border-amber-200/60 space-y-2">
              <label className="block text-xs font-bold text-amber-950 uppercase tracking-wider">
                Modalidade de Restauração:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div
                  onClick={() => setRestoreMode('replace')}
                  className={`p-3.5 rounded-lg border text-xs cursor-pointer transition-all ${
                    restoreMode === 'replace'
                      ? 'bg-red-50/80 border-red-300 ring-1 ring-red-400'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <input
                      type="radio"
                      name="restoreMode"
                      checked={restoreMode === 'replace'}
                      onChange={() => setRestoreMode('replace')}
                      className="text-red-700"
                    />
                    <span>Modo A — Substituir a base</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1 pl-5">
                    O banco corresponderá exatamente ao backup. Registros atuais não presentes no arquivo serão removidos. Ideal para recuperação de estado exato.
                  </p>
                </div>

                <div
                  onClick={() => setRestoreMode('merge')}
                  className={`p-3.5 rounded-lg border text-xs cursor-pointer transition-all ${
                    restoreMode === 'merge'
                      ? 'bg-emerald-50/80 border-emerald-300 ring-1 ring-emerald-400'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <input
                      type="radio"
                      name="restoreMode"
                      checked={restoreMode === 'merge'}
                      onChange={() => setRestoreMode('merge')}
                      className="text-emerald-700"
                    />
                    <span>Modo B — Mesclar dados</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1 pl-5">
                    Insere novos e atualiza registros existentes pelo ID. Registros atuais que não constem no backup são preservados intactos.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={handleExecuteRestore}
                disabled={isProcessing || !previewData.valid}
                className={`px-5 py-2 text-xs font-semibold text-white rounded-lg disabled:opacity-50 transition-colors shadow-xs ${
                  restoreMode === 'replace' ? 'bg-red-700 hover:bg-red-800' : 'bg-emerald-700 hover:bg-emerald-800'
                }`}
              >
                {isProcessing
                  ? 'Restaurando...'
                  : restoreMode === 'replace'
                  ? 'Confirmar e Substituir Base Completa'
                  : 'Confirmar e Mesclar Dados'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Isolamento e Gerenciamento de Dados Demonstrativos */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-4 shadow-xs">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
          <DatabaseBackup className="w-5 h-5 text-slate-700" />
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Gestão de Dados Demonstrativos
            </h3>
            <p className="text-xs text-slate-500">
              Controle explícito para limpar cadastros de exemplo e operar com uma base 100% limpa e personalizada
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
          <div className="text-xs text-slate-600 max-w-lg">
            <p className="font-semibold text-slate-800">Deseja iniciar sua produtora com cadastros vazios?</p>
            <p className="mt-0.5">
              Remova os itens pré-cadastrados (Sony FX3, diárias, custos fixos modelo). Orçamentos históricos já salvos permanecerão intactos com seus snapshots.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenClearDemoModal}
              disabled={isProcessing}
              className="px-3.5 py-1.5 text-xs font-semibold text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors shadow-xs"
            >
              Remover Dados de Exemplo
            </button>
            <button
              type="button"
              onClick={handleRestoreDemoData}
              disabled={isProcessing}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-xs"
            >
              Recarregar Exemplos
            </button>
          </div>
        </div>
      </div>

      {/* Princípios de Segurança e Privacidade */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-xs text-slate-500 space-y-2">
        <h4 className="font-bold text-slate-800">Diretrizes de Segurança &amp; Privacidade Local</h4>
        <ul className="list-disc list-inside space-y-1">
          <li>Todos os cálculos financeiros ocorrem localmente no seu computador, sem chamadas a APIs externas.</li>
          <li>Nenhum dado cadastral ou financeiro é enviado a servidores de inteligência artificial ou serviços de terceiros.</li>
          <li>Os backups gerados são arquivos locais autônomos que você pode guardar no seu drive ou backup do macOS (Time Machine).</li>
          <li>Antes de cada restauração, o sistema gera automaticamente uma cópia de segurança prévia na pasta <code>data/</code>.</li>
        </ul>
      </div>

      {/* Modal de Confirmação com Listagem de Registros Demonstrativos */}
      {demoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 text-red-700 font-bold text-base">
                <Trash2 className="w-5 h-5 text-red-600" />
                <span>Remoção de Dados Demonstrativos</span>
              </div>
              <button
                type="button"
                onClick={() => setDemoModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Esta operação removerá <strong>exclusivamente</strong> os cadastros de modelo e demonstração oficiais pré-instalados na aplicação, permitindo que você comece com uma base 100% personalizada.
            </p>

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Proteção Rigorosa dos Seus Dados:</p>
                <p className="text-[11px] text-emerald-800 mt-0.5">
                  Seus orçamentos salvos, propostas comerciais já emitidas e todos os cadastros criados por você (mesmo com prefixos padrão) <strong>não serão afetados</strong> e permanecerão preservados.
                </p>
              </div>
            </div>

            {loadingDemoItems ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Identificando itens de demonstração na base...
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  Itens canônicos que serão removidos ({demoItems.length}):
                </p>
                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl p-2 divide-y divide-slate-100 text-xs">
                  {demoItems.length === 0 ? (
                    <div className="p-4 text-center text-slate-400 text-xs">
                      Nenhum registro demonstrativo ativo encontrado na base.
                    </div>
                  ) : (
                    demoItems.map((item) => (
                      <div key={item.id} className="py-1.5 px-2 flex items-center justify-between">
                        <span className="font-medium text-slate-800 truncate mr-2">{item.name}</span>
                        <span className="shrink-0 px-2 py-0.5 text-[10px] rounded bg-slate-100 text-slate-600 font-semibold">
                          {item.categoryLabel}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDemoModalOpen(false)}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmClearDemo}
                disabled={isProcessing || loadingDemoItems || demoItems.length === 0}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg disabled:opacity-50 transition-colors shadow-xs"
              >
                {isProcessing ? 'Removendo...' : 'Confirmar e Limpar Dados Demonstrativos'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
