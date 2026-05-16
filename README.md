# Processador de Consultas SQL

Aplicação web estática para demonstrar, passo a passo, como uma consulta SQL simples pode ser validada, convertida para álgebra relacional, representada como grafo de operadores, otimizada e transformada em um plano lógico de execução.

O projeto foi organizado em cinco histórias/etapas:

- **HU1 - Validação:** análise sintática e semântica da consulta SQL.
- **HU2 - Álgebra Relacional:** conversão da consulta válida para uma árvore de álgebra relacional.
- **HU3 - Grafo de Operadores:** visualização da árvore de consulta como grafo.
- **HU4 - Otimização:** aplicação de heurísticas sobre a árvore.
- **HU5 - Plano de Execução:** geração de uma lista ordenada de passos lógicos.

## Como executar

Não há etapa de build, servidor backend ou instalação de dependências. Basta abrir o arquivo `index.html` em um navegador moderno.

Opções:

1. Abrir `index.html` diretamente pelo explorador de arquivos.
2. Usar uma extensão como Live Server, caso queira recarregamento automático durante desenvolvimento.
3. Servir a pasta com qualquer servidor estático simples.

Exemplo com Python:

```bash
python -m http.server 8000
```

Depois acesse:

```text
http://localhost:8000
```

## Estrutura do projeto

```text
.
+-- index.html
+-- style.css
+-- scripts/
    +-- schema.js
    +-- parserUtils.js
    +-- parser.js
    +-- algebra.js
    +-- grafo.js
    +-- plano.js
    +-- app.js
```

### `index.html`

Define a interface da aplicação: editor SQL, abas de resultado, painel do modelo de dados, lista de operadores aceitos e botões de exemplo. Os scripts são carregados no final da página nesta ordem:

```html
<script src="scripts/schema.js"></script>
<script src="scripts/parserUtils.js"></script>
<script src="scripts/parser.js"></script>
<script src="scripts/algebra.js"></script>
<script src="scripts/grafo.js"></script>
<script src="scripts/plano.js"></script>
<script src="scripts/app.js"></script>
```

Essa ordem importa porque os arquivos compartilham funções e constantes no escopo global do navegador.

### `style.css`

Contém toda a aparência da interface: layout, abas, editor, cards, tabelas, árvore/grafo, estados de sucesso/erro e responsividade.

### `scripts/schema.js`

Centraliza os metadados do banco usado pela aplicação:

- tabelas disponíveis;
- chave primária de cada tabela;
- campos de cada tabela;
- campos tratados como chaves estrangeiras;
- palavras reservadas;
- operadores de comparação suportados;
- exemplos carregados pelos chips do editor.

As tabelas cadastradas são:

- `Categoria`
- `Produto`
- `TipoCliente`
- `Cliente`
- `TipoEndereco`
- `Endereco`
- `Telefone`
- `Status`
- `Pedido`
- `Pedido_has_Produto`

### `scripts/parserUtils.js`

Centraliza os utilitários usados pelo parser. Ele reúne funções léxicas, funções de validação de condições e funções de validação de `JOIN`.

Principais responsabilidades:

- remover ponto e vírgula final e normalizar espaços;
- tokenizar a consulta para exibição na tela;
- procurar tabelas no `SCHEMA`;
- validar literais e identificadores;
- dividir condições compostas por `AND`;
- validar operandos de comparações;
- validar blocos `JOIN ... ON ...`.

As funções principais desse arquivo são:

- `schemaKey()`;
- `isReserved()`;
- `isLiteral()`;
- `isIdentifier()`;
- `cleanSqlInput()`;
- `extractParsed()`;
- `tokenize()`;
- `classifyTok()`;
- `validateCondition()`;
- `splitByAnd()`;
- `validateAtom()`;
- `findTablesContainingAttribute()`;
- `referencedTablesInExpression()`;
- `isWrapped()`;
- `findOperatorIndex()`;
- `validateOperand()`;
- `extractAndValidateJoins()`;
- `canonicalSelectAttr()`;
- `hasInvalidSymbolicOperator()`.

### `scripts/parser.js`

Responsável pelo fluxo principal da HU1. Ele recebe o SQL digitado, coordena a validação e, quando a consulta está correta, gera a estrutura `parsed` usada pelas próximas etapas.

Esse arquivo depende dos utilitários definidos em `scripts/parserUtils.js`, por isso `parserUtils.js` precisa ser carregado antes de `parser.js` no `index.html`.

Principais responsabilidades de `parser.js`:

- validar se a consulta começa com `SELECT` e possui `FROM`;
- identificar tabelas declaradas em `FROM` e `JOIN`;
- validar existência de tabelas e atributos contra o `SCHEMA`;
- detectar atributos ambíguos quando mais de uma tabela possui o mesmo campo;
- validar `WHERE` e `ON`;
- validar parênteses;
- rejeitar recursos fora do escopo.

Quando a consulta é válida, o parser retorna uma estrutura `parsed` com:

- colunas do `SELECT`;
- tabela principal do `FROM`;
- lista de `JOINs`;
- condição do `WHERE`;
- tabelas usadas.

Essa estrutura alimenta as próximas etapas.

### `scripts/algebra.js`

Responsável pela HU2 e HU4.

Na HU2, a função `toAlgebra(parsed)` converte a consulta validada para uma árvore de álgebra relacional. A árvore usa nós como:

- `rel`: relação/tabela;
- `equi`: equijunção;
- `theta`: junção theta;
- `sigma`: seleção (`WHERE`);
- `pi`: projeção (`SELECT`).

Exemplo conceitual:

```sql
SELECT Produto.Nome, Categoria.Descricao
FROM Produto
JOIN Categoria ON Produto.Categoria_idCategoria = Categoria.idCategoria
WHERE Produto.Preco > 50
```

Vira uma árvore equivalente a:

```text
PI Produto.Nome, Categoria.Descricao
  SIGMA Produto.Preco > 50
    JOIN Produto.Categoria_idCategoria = Categoria.idCategoria
      Produto
      Categoria
```

Na HU4, a função `optimizeTree(tree)` aplica heurísticas lógicas:

- extrai seleções do topo da árvore;
- empurra seleções para perto das relações quando a condição referencia uma tabela de forma qualificada;
- preserva condições que dependem de mais de uma tabela;
- reordena visualmente algumas junções quando há subárvores mais restritivas;
- insere projeções intermediárias para manter apenas atributos necessários ao `SELECT`, `WHERE` e `JOIN`;
- devolve uma árvore otimizada e uma lista de passos explicativos.

### `scripts/grafo.js`

Responsável pela HU3. Converte a árvore de álgebra em uma representação de grafo em memória e também em HTML visual.

A função `astToGraph(tree)` percorre a árvore e gera:

- `nodes`: lista de nós com id, tipo e rótulo;
- `edges`: arestas indicando fluxo de resultado intermediário;
- `rootId`: nó raiz da árvore.

A leitura do grafo é de baixo para cima:

1. as relações ficam nas folhas;
2. os operadores intermediários recebem resultados das folhas/subárvores;
3. a projeção final fica na raiz.

### `scripts/plano.js`

Responsável pela HU5. Gera um plano lógico de execução a partir da árvore otimizada.

A função `astToExecutionPlan(node)` percorre a árvore em pós-ordem, ou seja, visita primeiro os filhos e depois o operador atual. Isso produz uma ordem natural de execução:

1. acessar relações;
2. aplicar seleções;
3. realizar junções;
4. aplicar projeções.

O resultado é renderizado como uma lista numerada pela função `renderPlanoExecucao(tree)`.

### `scripts/app.js`

É o ponto de integração da aplicação.

Principais funções:

- monta a barra lateral com o modelo de dados;
- atualiza numeração de linhas e contador de caracteres;
- alterna abas;
- carrega exemplos;
- limpa a interface;
- renderiza resultados;
- habilita pan/arraste no grafo;
- coordena o fluxo completo pelo método `processar()`.

O fluxo principal é:

```text
SQL digitado
  -> parse(sql)
  -> renderValidacao(...)
  -> toAlgebra(parsed)
  -> astToGraph(tree)
  -> optimizeTree(tree)
  -> astToGraph(optimizedTree)
  -> renderPlanoExecucao(optimizedTree)
```

Se a validação encontrar erros, as etapas HU2 a HU5 exibem mensagens pedindo a correção da consulta antes de continuar.

## Subconjunto SQL suportado

O projeto aceita consultas de leitura com:

- `SELECT campo1, campo2`
- `SELECT *`
- `FROM Tabela`
- `JOIN Tabela ON condição`
- múltiplos `JOINs`
- `WHERE condição`
- condições com `AND`
- parênteses em condições
- operandos qualificados, como `Produto.Preco`
- operandos simples, desde que não sejam ambíguos
- literais numéricos, como `50` ou `10.5`
- literais texto com aspas simples, como `'Ana'`

Operadores de comparação aceitos:

```text
=, >, <, >=, <=, <>
```

## Recursos fora do escopo

Alguns recursos SQL são rejeitados de propósito para manter o processador dentro do escopo didático:

- apelidos de tabela (`AS` ou apelido após o nome da tabela);
- `OR`;
- `NOT`;
- `LIKE`;
- `IN`;
- `BETWEEN`;
- `IS`;
- `GROUP BY`;
- `ORDER BY`;
- `HAVING`;
- `DISTINCT`;
- `LIMIT`;
- funções de agregação (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`);
- `UNION`, `INTERSECT`, `EXCEPT`;
- subconsultas;
- operadores como `!=` e `==`.

## Exemplos de consultas válidas

Consulta simples:

```sql
SELECT idProduto, Nome, Preco
FROM Produto
```

Consulta com filtro:

```sql
SELECT Nome, Email
FROM Cliente
WHERE TipoCliente_idTipoCliente = 1
```

Consulta com `JOIN` e `WHERE`:

```sql
SELECT Produto.Nome, Categoria.Descricao
FROM Produto
JOIN Categoria ON Produto.Categoria_idCategoria = Categoria.idCategoria
WHERE Produto.Preco > 50
```

Consulta com múltiplos `JOINs`:

```sql
SELECT Cliente.Nome, Pedido.DataPedido, Produto.Nome, Pedido_has_Produto.Quantidade
FROM Cliente
JOIN Pedido ON Pedido.Cliente_idCliente = Cliente.idCliente
JOIN Pedido_has_Produto ON Pedido_has_Produto.Pedido_idPedido = Pedido.idPedido
JOIN Produto ON Produto.idProduto = Pedido_has_Produto.Produto_idProduto
```

## Como o processamento funciona

### 1. Validação

O parser verifica primeiro se a consulta pertence ao subconjunto aceito. Em seguida, confere tabelas, atributos, operadores, parênteses, duplicidade de atributos e ambiguidade.

Exemplo de ambiguidade:

```sql
SELECT Nome
FROM Cliente
JOIN Produto ON Produto.idProduto = Cliente.idCliente
```

Se mais de uma tabela declarada possui `Nome`, o sistema pede o atributo qualificado, como `Cliente.Nome` ou `Produto.Nome`.

### 2. Álgebra relacional

Depois da validação, a consulta é transformada em uma árvore. A construção segue a ordem lógica:

1. relação base do `FROM`;
2. junções do `JOIN`;
3. seleção do `WHERE`;
4. projeção do `SELECT`.

### 3. Grafo de operadores

A árvore de álgebra é renderizada como grafo. Cada operador vira um nó, e cada dependência vira uma aresta de resultado intermediário.

### 4. Otimização

A árvore original passa por heurísticas clássicas de otimização lógica:

- seleções são aplicadas o mais cedo possível;
- atributos desnecessários são removidos por projeções intermediárias;
- junções são mantidas com suas condições para evitar produto cartesiano.

Essa etapa não executa a consulta em um banco real. Ela apenas reorganiza a representação lógica da consulta.

### 5. Plano de execução

A árvore otimizada é percorrida de baixo para cima. O resultado é uma sequência de passos que mostra a ordem lógica em que as operações deveriam acontecer.

## Observações importantes

- O projeto roda inteiramente no navegador.
- Não há conexão com banco de dados real.
- O schema é fixo e está definido em `scripts/schema.js`.
- O objetivo é educacional: visualizar as etapas de processamento de consultas.
- As funções usam escopo global, porque os scripts são carregados diretamente pelo HTML, sem bundler ou sistema de módulos.
- A ordem dos scripts no `index.html` é obrigatória: `schema.js` define os dados, `parserUtils.js` define os utilitários, `parser.js` usa esses utilitários, e os demais arquivos usam o resultado do parser.
- Para alterar o modelo de dados, edite o objeto `SCHEMA` e, se necessário, a lista `FK_FIELDS`.
