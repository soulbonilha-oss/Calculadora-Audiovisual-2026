import { jsPDF } from 'jspdf';
import { StudioSettings } from '../types';
import { formatBRL } from '../financial/engine';

export interface CommercialProposalData {
  proposalCode: string;
  clientName: string;
  clientCompany?: string;
  clientEmail?: string;
  clientPhone?: string;
  projectTitle: string;
  scopeSummary: string;
  commercialHours: {
    preProductionHours: number;
    productionHours: number;
    postProductionHours: number;
  };
  totalPrice: number;
  cashDiscountPct: number;
  cashPrice: number;
  installmentCount: number;
  installmentValue: number;
  issueDate: string; // YYYY-MM-DD
  validUntilDate: string; // YYYY-MM-DD
  settings: StudioSettings;
  customNotes?: string;
}

export function generateCommercialProposalPdf(data: CommercialProposalData): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;

  // Paleta oficial FBonilha.mov (Manifesto)
  const primaryColor = data.settings.primary_color || '#4F5D47'; // Verde Musgo Cinematográfico
  const petrolColor = '#2F5C61'; // Azul Petróleo
  const terracottaColor = '#A55C3B'; // Terracota Queimado
  const darkTextColor = '#232323'; // Grafite Orgânico
  const mutedTextColor = '#595550'; // Grafite Secundário
  const lightBgColor = '#FAF8F5'; // Marfim Quente Suave
  const cardBorderColor = '#E8E2D6'; // Borda Linho / Marfim

  // 1. Top Decorative Bar em Verde Musgo
  doc.setFillColor(primaryColor);
  doc.rect(0, 0, pageWidth, 5, 'F');

  let currentY = 22;

  // 2. Header: Logo / Studio Name & Document Code
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(primaryColor);
  doc.text(data.settings.studio_name || 'FBonilha.mov', margin, currentY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(mutedTextColor);
  doc.text('PROPOSTA COMERCIAL', pageWidth - margin, currentY - 5, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(darkTextColor);
  doc.text(data.proposalCode, pageWidth - margin, currentY + 1, { align: 'right' });

  currentY += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(mutedTextColor);
  const studioContact = [
    data.settings.phone,
    data.settings.email,
    data.settings.website,
    data.settings.cnpj ? `CNPJ: ${data.settings.cnpj}` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');
  doc.text(studioContact, margin, currentY);

  // Linha divisória sutil
  currentY += 6;
  doc.setDrawColor(cardBorderColor);
  doc.setLineWidth(0.4);
  doc.line(margin, currentY, pageWidth - margin, currentY);

  // 3. Informações do Projeto e Cliente
  currentY += 12;
  doc.setFillColor(lightBgColor);
  doc.roundedRect(margin, currentY, contentWidth, 26, 2, 2, 'F');
  doc.setDrawColor(cardBorderColor);
  doc.roundedRect(margin, currentY, contentWidth, 26, 2, 2, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(primaryColor);
  doc.text('CLIENTE & PROJETO', margin + 6, currentY + 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(darkTextColor);
  doc.text(data.projectTitle, margin + 6, currentY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(mutedTextColor);
  const clientInfo = [
    data.clientName,
    data.clientCompany ? `(${data.clientCompany})` : '',
    data.clientEmail,
    data.clientPhone,
  ]
    .filter(Boolean)
    .join('  ·  ');
  doc.text(clientInfo, margin + 6, currentY + 20);

  // Datas de Emissão e Validade à direita do card
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(mutedTextColor);
  doc.text(`Emissão: ${formatDateBR(data.issueDate)}`, pageWidth - margin - 6, currentY + 12, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(terracottaColor); // Destaque na validade de 7 dias com Terracota Queimado
  doc.text(`Validade (7 dias): ${formatDateBR(data.validUntilDate)}`, pageWidth - margin - 6, currentY + 18, {
    align: 'right',
  });

  // 4. Escopo do Projeto
  currentY += 34;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(darkTextColor);
  doc.text('Escopo dos Serviços', margin, currentY);

  currentY += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(darkTextColor);
  const scopeText =
    data.scopeSummary ||
    'Produção audiovisual personalizada, incluindo planejamento de roteiro, diárias de captação cinematográfica com iluminação e áudio dedicado, decupagem, montagem, edição de cores (color grading), finalização e trilha sonora licenciada.';
  const splitScope = doc.splitTextToSize(scopeText, contentWidth);
  doc.text(splitScope, margin, currentY);
  currentY += splitScope.length * 4.5 + 4;

  // 5. Cronograma Estimado de Dedicação (Resumo Comercial de Etapas)
  // REGRA DE SEGURANÇA: NUNCA expor equipamentos, custos de terceiros ou taxas internas
  currentY += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(petrolColor);
  doc.text('Cronograma de Dedicação Profissional', margin, currentY);

  currentY += 6;
  const colWidth = contentWidth / 3;

  // Box Pré-produção
  drawStageCard(
    doc,
    margin,
    currentY,
    colWidth - 2,
    'Pré-Produção',
    `${data.commercialHours.preProductionHours.toFixed(1)} horas`,
    'Alinhamento, roteirização, decupagem e cronograma',
    primaryColor
  );

  // Box Captação
  drawStageCard(
    doc,
    margin + colWidth + 1,
    currentY,
    colWidth - 2,
    'Captação',
    `${data.commercialHours.productionHours.toFixed(1)} horas`,
    'Diárias de filmagem, áudio direto e direção',
    primaryColor
  );

  // Box Pós-produção
  drawStageCard(
    doc,
    margin + colWidth * 2 + 2,
    currentY,
    colWidth - 2,
    'Pós-Produção',
    `${data.commercialHours.postProductionHours.toFixed(1)} horas`,
    'Edição, sound design, colorização e masters',
    primaryColor
  );

  currentY += 28;

  // 6. Proposta de Investimento e Condições de Pagamento
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(darkTextColor);
  doc.text('Condições Comerciais e Investimento', margin, currentY);

  currentY += 6;
  const halfWidth = (contentWidth - 6) / 2;

  // Card Condição À Vista
  doc.setFillColor(lightBgColor);
  doc.roundedRect(margin, currentY, halfWidth, 34, 2, 2, 'F');
  doc.setDrawColor(primaryColor);
  doc.setLineWidth(0.6);
  doc.roundedRect(margin, currentY, halfWidth, 34, 2, 2, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(primaryColor);
  doc.text(`PAGAMENTO À VISTA (${data.cashDiscountPct}% DE DESCONTO)`, margin + 6, currentY + 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(darkTextColor);
  doc.text(formatBRL(data.cashPrice), margin + 6, currentY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(mutedTextColor);
  doc.text('Transferência PIX ou TED na aprovação da proposta.', margin + 6, currentY + 25);
  doc.text(`Economia direta de ${formatBRL(data.totalPrice - data.cashPrice)}.`, margin + 6, currentY + 29);

  // Card Condição Parcelada
  doc.setFillColor(lightBgColor);
  doc.roundedRect(margin + halfWidth + 6, currentY, halfWidth, 34, 2, 2, 'F');
  doc.setDrawColor(cardBorderColor);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin + halfWidth + 6, currentY, halfWidth, 34, 2, 2, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(darkTextColor);
  doc.text(`PARCELAMENTO EM ${data.installmentCount}X SEM JUROS`, margin + halfWidth + 12, currentY + 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(darkTextColor);
  doc.text(`${data.installmentCount}x de ${formatBRL(data.installmentValue)}`, margin + halfWidth + 12, currentY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(mutedTextColor);
  doc.text(`Total do investimento: ${formatBRL(data.totalPrice)}`, margin + halfWidth + 12, currentY + 25);
  doc.text('Boleto bancário com vencimentos programados.', margin + halfWidth + 12, currentY + 29);

  currentY += 42;

  // 7. Observações e Termos Comerciais
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(darkTextColor);
  doc.text('Termos & Condições de Atendimento', margin, currentY);

  currentY += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(mutedTextColor);

  const defaultTerms =
    data.customNotes ||
    data.settings.terms_and_conditions ||
    '1. A aprovação desta proposta assegura a reserva da equipe técnica nas datas acordadas.\n2. A validade comercial da proposta é de 7 (sete) dias corridos a partir da data de emissão.\n3. O prazo de entrega do corte final tem início após a conclusão da última diária de captação.\n4. Todos os direitos patrimoniais de uso comercial dos vídeos finais são do cliente.';

  const splitTerms = doc.splitTextToSize(defaultTerms, contentWidth);
  doc.text(splitTerms, margin, currentY);

  // 8. Rodapé Fixo
  doc.setDrawColor(cardBorderColor);
  doc.setLineWidth(0.3);
  doc.line(margin, pageHeight - 16, pageWidth - margin, pageHeight - 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(mutedTextColor);
  doc.text(
    `${data.settings.studio_name || 'FBonilha Audiovisual'}  ·  Documento oficial gerado localmente em ${formatDateBR(data.issueDate)}`,
    margin,
    pageHeight - 10
  );
  doc.text(`Página 1 de 1`, pageWidth - margin, pageHeight - 10, { align: 'right' });

  return doc;
}

function drawStageCard(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  title: string,
  hours: string,
  description: string,
  accentColor: string = '#4F5D47'
) {
  doc.setFillColor('#FAF8F5');
  doc.roundedRect(x, y, width, 22, 1.5, 1.5, 'F');
  doc.setDrawColor('#E8E2D6');
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, width, 22, 1.5, 1.5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor('#232323');
  doc.text(title, x + 4, y + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(accentColor);
  doc.text(hours, x + 4, y + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor('#595550');
  const splitDesc = doc.splitTextToSize(description, width - 8);
  doc.text(splitDesc, x + 4, y + 17);
}

function formatDateBR(dateStr?: string): string {
  if (!dateStr) return '';
  const parts = dateStr.slice(0, 10).split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

export function sanitizeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40);
}
