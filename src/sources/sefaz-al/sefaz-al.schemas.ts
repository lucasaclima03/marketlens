import { z } from 'zod';

export const sefazAlVendaSchema = z.object({
  dataVenda: z.string().datetime({ offset: true }),
  valorDeclarado: z.number(),
  valorVenda: z.number(),
});

export const sefazAlProdutoSchema = z.object({
  codigo: z.string(),
  descricao: z.string(),
  descricaoSefaz: z.string().optional(),
  gtin: z.string(),
  ncm: z.string(),
  gpc: z.string(),
  unidadeMedida: z.string(),
  venda: sefazAlVendaSchema,
});

export const sefazAlEnderecoSchema = z.object({
  nomeLogradouro: z.string(),
  numeroImovel: z.string(),
  bairro: z.string(),
  cep: z.string(),
  codigoIBGE: z.number().int(),
  municipio: z.string(),
  latitude: z.number(),
  longitude: z.number(),
});

export const sefazAlEstabelecimentoSchema = z.object({
  cnpj: z.string(),
  razaoSocial: z.string(),
  nomeFantasia: z.string().optional(),
  telefone: z.string().optional(),
  endereco: sefazAlEnderecoSchema,
});

export const sefazAlPriceItemSchema = z.object({
  produto: sefazAlProdutoSchema,
  estabelecimento: sefazAlEstabelecimentoSchema,
});

export const sefazAlPriceResponseSchema = z.object({
  conteudo: z.array(sefazAlPriceItemSchema),
  pagina: z.number().int(),
  primeiraPagina: z.boolean(),
  registrosPagina: z.number().int(),
  registrosPorPagina: z.number().int(),
  totalPaginas: z.number().int(),
  totalRegistros: z.number().int(),
  ultimaPagina: z.boolean(),
});

export type SefazAlVenda = z.infer<typeof sefazAlVendaSchema>;
export type SefazAlProduto = z.infer<typeof sefazAlProdutoSchema>;
export type SefazAlEndereco = z.infer<typeof sefazAlEnderecoSchema>;
export type SefazAlEstabelecimento = z.infer<typeof sefazAlEstabelecimentoSchema>;
export type SefazAlPriceItem = z.infer<typeof sefazAlPriceItemSchema>;
export type SefazAlPriceResponse = z.infer<typeof sefazAlPriceResponseSchema>;
