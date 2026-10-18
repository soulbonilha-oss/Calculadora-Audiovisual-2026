# FBonilha Audiovisual — Sistema Profissional de Orçamentos & Precificação

Aplicativo completo de cálculo analítico de custos, formação de preços, simulação de rentabilidade e emissão de propostas comerciais para produtoras audiovisuais.

Desenvolvido para uso local e independente no **macOS** (e outros sistemas operacionais), com persistência em banco de dados **SQLite real com WAL mode**, geração de propostas em **PDF** sem exposição de dados de custos internos e testes unitários automatizados.

---

## 1. Arquitetura do Sistema

```
fbonilha-audiovisual/
├── data/
│   └── fbonilha.sqlite          # Banco SQLite físico local (WAL mode ativado)
├── server/
│   ├── db.ts                    # Inicialização do SQLite, migrações versionadas e seeds
│   └── api.ts                   # Rotas REST locais Express (CRUD, snapshots e backups)
├── src/
│   ├── financial/
│   │   ├── engine.ts            # Motor de cálculo financeiro desacoplado e funções puras
│   │   └── engine.test.ts       # Testes unitários com node:test das regras da Seção 20
│   ├── components/
│   │   ├── layout/              # Sidebar e Header (Top Bar Contract 3 zonas + mobile drawer)
│   │   ├── dashboard/           # Visão geral, pipeline orçado, margens e alertas
│   │   ├── equipment/           # Biblioteca de equipamentos e métodos A e B de depreciação
│   │   ├── expenses/            # Custos fixos mensais com rateio e catálogo de extras
│   │   ├── professionals/       # Equipe técnica e prestadores terceirizados
│   │   ├── templates/           # Modelos reutilizáveis de produção
│   │   ├── budgets/             # Editor de orçamento com 8 abas e lista de orçamentos salvos
│   │   ├── settings/            # Parâmetros gerais do estúdio e padrões de proposta
│   │   └── backup/              # Exportação SQLite/JSON e restauração com validação
│   ├── utils/
│   │   └── pdfGenerator.ts      # Geração client-side de propostas comerciais em PDF via jsPDF
│   ├── types/
│   │   └── index.ts             # Definições tipadas TypeScript completas
│   ├── App.tsx                  # Shell central da aplicação e roteamento visual
│   ├── main.tsx                 # Entrada React
│   └── index.css                # Tailwind CSS v4 e tipografia editorial
├── public/
│   ├── manifest.json            # PWA Web App Manifest
│   └── icon.svg                 # Ícone da aplicação
├── server.ts                    # Servidor Fullstack Express + Vite Middleware na porta 3000
└── package.json
```

---

## 2. Instruções de Instalação e Execução no macOS

### 2.1. Pré-requisitos
- **macOS** (compatível com Apple Silicon M1/M2/M3/M4 e Intel)
- **Node.js 22+** instalado (pode ser instalado via [nodejs.org](https://nodejs.org) ou `brew install node`)

### 2.2. Instalação
Abra o Terminal no diretório do projeto e execute:
```bash
npm install --legacy-peer-deps
```

### 2.3. Executar o Aplicativo
```bash
npm run dev
```
O sistema iniciará o servidor local integrado e abrirá o banco SQLite em `data/fbonilha.sqlite`. Acesse no seu navegador preferido (Safari, Chrome, etc.):
```
http://localhost:3000
```

### 2.4. Encerrar o Aplicativo
No terminal onde o aplicativo está rodando, pressione:
```bash
Ctrl + C
```

### 2.5. Executar os Testes Automatizados
```bash
npm test
```

---

## 3. Banco de Dados SQLite & Snapshots Imutáveis

- **Localização:** `data/fbonilha.sqlite`
- **Modo:** `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`
- **Integridade Histórica:** Ao adicionar equipamentos, mão de obra, terceiros ou despesas a um orçamento, os valores são armazenados como **snapshots imutáveis** dentro do registro do orçamento. Atualizações futuras no cadastro geral do equipamento ou no valor da hora do profissional não modificam silenciosamente projetos históricos já salvos ou aprovados.

---

## 4. Fórmulas e Regras do Motor Financeiro

### 4.1. Depreciação de Equipamentos (E)
- **Método A (Horas totais):** `Depreciação por Hora = (Valor de Compra − Valor Residual) / Horas Úteis Totais`
- **Método B (Horas anuais × Anos):** `Horas Úteis = Horas Anuais × Vida Útil em Anos`
- **Custo no Projeto:** `Custo de Depreciação = Depreciação por Hora × Horas de Uso no Projeto + Locação/Manutenção Extra`

### 4.2. Mão de Obra Própria (M)
- `Custo da Etapa = Horas da Etapa × Valor por Hora`
- `Custo Total M = Soma dos Custos das Etapas Profissionais`
- Conversão decimal exata: `1h30 = 1,5 hora`.

### 4.3. Rateio de Custos Fixos Mensais (F)
- `Custo Fixo por Hora = Soma dos Custos Fixos Mensais Ativos / Horas Faturáveis Previstas por Mês`
- `Rateio do Projeto F = Custo Fixo por Hora × Horas Elegíveis do Profissional Responsável`
- Divisão por zero bloqueada preventivamente caso as horas faturáveis sejam zero.

### 4.4. Custo Total Operacional (C)
```
C = M + E + F + S + T + X
```
- **M:** Mão de obra própria
- **E:** Depreciação de equipamentos e locações
- **F:** Custos fixos rateados
- **S:** Assinaturas e materiais extras diretos
- **T:** Prestadores de serviços terceirizados e assistentes
- **X:** Outras despesas e taxas fixas transacionais

### 4.5. Métodos de Formação de Preço
1. **Margem de Lucro sobre a Venda:**
   ```
   P = C / (1 − t − f − m)
   ```
   - `t`: Alíquota de impostos (ex: 6%)
   - `f`: Taxa financeira (ex: 2,5%)
   - `m`: Margem líquida pretendida sobre o preço final (ex: 25%)
2. **Acréscimo sobre o Custo (Markup):**
   ```
   P = C × (1 + a) / (1 − t − f)
   ```
   - `a`: Percentual de acréscimo desejado sobre o custo operacional (ex: 35%)

### 4.6. Simulação das Condições de Pagamento
- **À Vista:** Preço base com 10% de desconto (`P × 0,90`). O sistema recalcula impostos, lucro líquido e margem efetiva no cenário à vista.
- **Parcelado (4x sem juros):** `Parcela = Preço Base / 4`. O sistema faz o balanço de centavos na última parcela garantindo que a soma resulte exatamente no valor total em centavos.

---

## 5. Proposta Comercial em PDF (Regras de Confidencialidade)

Conforme os princípios fundamentais da produtora:
- **O que aparece:** Nome da FBonilha, dados de contato, cliente, nome do projeto, data de emissão, validade de 7 dias corridos, escopo resumido, resumo das horas comerciais (Pré-produção, Captação, Pós-produção), valor total, condição à vista e parcelamento em 4x sem juros.
- **O que NUNCA aparece:** Equipamentos utilizados, custos de compras, taxas de depreciação, valor individual da hora profissional, custos de terceirizados, despesas fixas ou margens de lucro.

---

## 6. Procedimento de Backup e Restauração

1. Acesse o menu lateral **Backup & Restauração**.
2. **Para Exportar:**
   - Clique em **Baixar Backup JSON** para obter o arquivo lógico de segurança com todos os cadastros e orçamentos.
   - Ou clique em **Baixar fbonilha.sqlite** para uma cópia física binária.
3. **Para Restaurar:**
   - Selecione o arquivo `.json`.
   - O sistema fará uma análise de integridade e exibirá a quantidade de registros encontrados.
   - Ao clicar em **Confirmar e Restaurar**, a operação é executada atomicamente dentro de uma transação SQL com rollback automático em caso de inconsistência.

---

## 7. Resultados dos Testes Automatizados

O sistema conta com suíte de testes com `node:test` em `src/financial/engine.test.ts` cobrindo todas as regras da Seção 20:
- `20.1`: Depreciação Caso 1 (10.000, residual 1.000, 3.000h = R$ 3,00/h; 8h = R$ 24,00) — **PASSOU**
- `20.1`: Depreciação Caso 2 (600h/ano * 5 anos = R$ 3,00/h) — **PASSOU**
- `20.1`: Validação de limites inválidos (residual > compra, horas zeradas, horas negativas) — **PASSOU**
- `20.2`: Rateio de custos fixos (3.000 / 100h = R$ 30,00/h; 20h = R$ 600,00) — **PASSOU**
- `20.2`: Prevenção de divisão por zero — **PASSOU**
- `20.3`: Mão de obra própria (3h @ 150 + 6h @ 150 + 10h @ 150 = R$ 2.850,00) — **PASSOU**
- `20.3`: Conversão de horas e minutos (1h30 = 1,5h) — **PASSOU**
- `20.4`: Formação de preço por margem sobre a venda (C=1000, t=10%, m=20% -> R$ 1.428,57) — **PASSOU**
- `20.4`: Formação de preço por markup sobre custo (C=1000, t=10%, a=20% -> R$ 1.333,33) — **PASSOU**
- `20.4`: Bloqueio quando soma de taxas e margem >= 100% — **PASSOU**
- `20.5`: Pagamento à vista com 10% e parcelamento 4x sem juros exato — **PASSOU**
- `20.5`: Ajuste de centavos na última parcela — **PASSOU**
- Contratação de terceiros (hora, diária e valor fechado) — **PASSOU**

---

## 8. Empacotamento Futuro (Tauri / Nativo)

A arquitetura foi desacoplada com APIs REST locais e SQLite com WAL mode. No futuro, o aplicativo pode ser empacotado como um binário nativo macOS (.app / .dmg) via **Tauri v2** sem necessidade de reescrever os componentes de frontend ou as regras financeiras.
