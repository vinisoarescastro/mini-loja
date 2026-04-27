/**
 * ══════════════════════════════════════════════════════════
 *  CONFIGURAÇÃO GLOBAL DA LOJA — edite APENAS este arquivo
 *  para alterar logo, nome, cor principal e parcelamento.
 * ══════════════════════════════════════════════════════════
 */
const SITE_CONFIG = {
  /** Caminho da imagem da logo (relativo à raiz pública) */
  logoUrl:  '/img/logo/logo_inf_colorido_branco.png',

  /** Texto alternativo da logo */
  logoAlt:  'ViniciusLoja',

  /** Nome exibido no <title> e no alt quando a logo não carrega */
  siteName: 'ViniciusLoja',

  /**
   * Número de parcelas exibidas nos cards e na página do produto.
   * Exemplos: 6 → "6x de R$ 11,00 sem juros"
   *           12 → "12x de R$ 5,50 sem juros"
   * Defina 1 para não exibir parcelamento.
   */
  installments: 6,
};