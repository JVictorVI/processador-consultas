/* ═══════════════════════════════════════════════════════
   PROCESSADOR DE CONSULTAS SQL — HU1 + HU2 + HU3 + HU4 + HU5
   schema.js — Metadados do banco de dados, constantes e exemplos
═══════════════════════════════════════════════════════ */
'use strict';

// ═══════════════════════════════════════════════════════
//  SCHEMA — metadados do banco de dados
// ═══════════════════════════════════════════════════════
const SCHEMA = {
  Categoria:          { pk: 'idCategoria',      fields: ['idCategoria','Descricao'] },
  Produto:            { pk: 'idProduto',        fields: ['idProduto','Nome','Descricao','Preco','QuantEstoque','Categoria_idCategoria'] },
  TipoCliente:        { pk: 'idTipoCliente',    fields: ['idTipoCliente','Descricao'] },
  Cliente:            { pk: 'idCliente',        fields: ['idCliente','Nome','Email','Nascimento','Senha','TipoCliente_idTipoCliente','DataRegistro'] },
  TipoEndereco:       { pk: 'idTipoEndereco',   fields: ['idTipoEndereco','Descricao'] },
  Endereco:           { pk: 'idEndereco',       fields: ['idEndereco','EnderecoPadrao','Logradouro','Numero','Complemento','Bairro','Cidade','UF','CEP','TipoEndereco_idTipoEndereco','Cliente_idCliente'] },
  Telefone:           { pk: null,               fields: ['Numero','Cliente_idCliente'] },
  Status:             { pk: 'idStatus',         fields: ['idStatus','Descricao'] },
  Pedido:             { pk: 'idPedido',         fields: ['idPedido','Status_idStatus','DataPedido','ValorTotalPedido','Cliente_idCliente'] },
  Pedido_has_Produto: { pk: 'idPedidoProduto',  fields: ['idPedidoProduto','Pedido_idPedido','Produto_idProduto','Quantidade','PrecoUnitario'] }
};

// Campos que são chaves estrangeiras (para destaque visual no schema)
const FK_FIELDS = [
  'Categoria_idCategoria','TipoCliente_idTipoCliente','TipoEndereco_idTipoEndereco',
  'Cliente_idCliente','Status_idStatus','Pedido_idPedido','Produto_idProduto'
];

// Palavras-chave SQL reservadas neste trabalho
const RESERVED = new Set([
  'SELECT','FROM','WHERE','JOIN','ON','AND','AS',
  'INNER','LEFT','RIGHT','FULL','OUTER',
  'OR','NOT','LIKE','IN','BETWEEN','IS',
  'GROUP','ORDER','BY','HAVING','DISTINCT','LIMIT',
  'UNION','INTERSECT','EXCEPT','INSERT','UPDATE','DELETE',
  'COUNT','SUM','AVG','MIN','MAX'
]);

// Operadores de comparação suportados (ordem: maior → menor, evita ambiguidade)
const CMP_OPS = ['<>', '>=', '<=', '=', '>', '<'];

// ─────────────────────────────────────────────────────
//  Exemplos de teste (chips do editor)
// ─────────────────────────────────────────────────────
const EXAMPLES = [
  // 0 - SELECT simples
  `SELECT idProduto, Nome, Preco\nFROM Produto`,
  // 1 - WHERE
  `SELECT Nome, Email\nFROM Cliente\nWHERE TipoCliente_idTipoCliente = 1`,
  // 2 - JOIN + WHERE
  `SELECT Produto.Nome, Categoria.Descricao\nFROM Produto\nJOIN Categoria ON Produto.Categoria_idCategoria = Categoria.idCategoria\nWHERE Produto.Preco > 50`,
  // 3 - Multi-JOIN
  `SELECT Cliente.Nome, Pedido.DataPedido, Produto.Nome, Pedido_has_Produto.Quantidade\nFROM Cliente\nJOIN Pedido ON Pedido.Cliente_idCliente = Cliente.idCliente\nJOIN Pedido_has_Produto ON Pedido_has_Produto.Pedido_idPedido = Pedido.idPedido\nJOIN Produto ON Produto.idProduto = Pedido_has_Produto.Produto_idProduto`,
  // 4 - WHERE composto com AND
  `SELECT Cliente.Nome, Pedido.ValorTotalPedido\nFROM Cliente\nJOIN Pedido ON Pedido.Cliente_idCliente = Cliente.idCliente\nWHERE Pedido.ValorTotalPedido > 200 AND Cliente.TipoCliente_idTipoCliente = 2`,
  // 5 - SELECT *
  `SELECT *\nFROM Produto`,
  // 6 - Erro: tabela inexistente
  `SELECT Nome FROM TabelaInexistente`,
  // 7 - Erro: atributo inexistente
  `SELECT CPF, Nome FROM Cliente`,
  // 8 - Erro: JOIN sem ON
  `SELECT Nome FROM Cliente JOIN Pedido`,
  // 9 - Erro: operador fora do escopo
  `SELECT Nome FROM Cliente WHERE Nome LIKE 'Ana%'`
];
