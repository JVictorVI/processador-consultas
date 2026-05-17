# Funções do Projeto

Este documento resume as principais constantes e funções do projeto. A aplicação usa JavaScript carregado diretamente no navegador, então as funções ficam no escopo global e são compartilhadas conforme a ordem definida no `index.html`.

## Ordem de carregamento

```text
schema.js
parserUtils.js
parser.js
algebra.js
grafo.js
plano.js
app.js
```

Essa ordem é obrigatória porque arquivos posteriores dependem de constantes e funções declaradas antes.

## `scripts/schema.js`

Arquivo com os metadados do modelo de dados e os exemplos usados pela interface.

### `SCHEMA`

Objeto que descreve as tabelas disponíveis. Cada tabela possui:

- `pk`: chave primária;
- `fields`: lista de atributos.

É usado para validar tabelas e campos, montar o painel de modelo de dados e expandir `SELECT *`.

### `FK_FIELDS`

Lista de campos tratados como chaves estrangeiras. A interface usa essa lista para destacar esses atributos no painel lateral.

### `RESERVED`

Conjunto de palavras reservadas SQL conhecidas pela aplicação. Ajuda a diferenciar identificadores comuns de palavras da linguagem.

### `CMP_OPS`

Lista de operadores de comparação aceitos:

```text
<>, >=, <=, =, >, <
```

A ordem prioriza operadores compostos antes dos simples.

### `EXAMPLES`

Lista de consultas carregadas pelos botões de exemplo. Inclui consultas válidas e consultas com erro.

## `scripts/parserUtils.js`

Arquivo de utilitários usados pelo parser. Ele depende de `schema.js` e é usado por `parser.js`, `algebra.js` e pela renderização da validação.

### `schemaKey(name)`

Procura uma tabela no `SCHEMA` ignorando maiúsculas e minúsculas. Retorna o nome canônico ou `null`.

### `isReserved(word)`

Verifica se uma palavra está em `RESERVED`.

### `isLiteral(tok)`

Verifica se um token é um literal aceito:

- número inteiro;
- número decimal;
- texto entre aspas simples.

### `isIdentifier(tok)`

Verifica se um token tem formato de identificador simples.

### `cleanSqlInput(sql)`

Normaliza a consulta:

- remove ponto e vírgula final;
- reduz espaços repetidos;
- remove espaços no início e no fim.

### `extractParsed(sql, usedTables, validatedJoins)`

Monta a estrutura `parsed` usada pela álgebra relacional. Retorna:

- colunas do `SELECT`;
- tabela base do `FROM`;
- lista de `JOINs`;
- condição do `WHERE`;
- tabelas usadas.

Quando recebe `validatedJoins`, reaproveita a lista já validada por `extractAndValidateJoins()`.

### `tokenize(sql)`

Divide a consulta em tokens para exibição. Reconhece identificadores, atributos qualificados, operadores, parênteses, vírgulas, asterisco, números e strings.

### `classifyTok(tok)`

Classifica tokens para a interface:

- palavra-chave;
- tabela;
- atributo;
- operador;
- outro.

### `validateCondition(condRaw, usedTables, errors, ctx)`

Valida uma condição de `WHERE` ou `ON`.

Verifica:

- parênteses balanceados;
- uso inválido de `AND`;
- predicados separados por `AND`;
- presença dos operandos e operadores de comparação.

### `splitByAnd(cond)`

Divide uma condição por `AND` de nível superior, respeitando parênteses.

### `validateAtom(atom, usedTables, errors, ctx)`

Valida um predicado individual, como:

```sql
Produto.Preco > 50
```

Identifica o operador, separa os operandos e verifica se os dois lados da comparação estão presentes.

### `findTablesContainingAttribute(attr, usedTables)`

Procura quais tabelas declaradas possuem determinado atributo. É usada para detectar atributos inexistentes ou ambíguos.

### `referencedTablesInExpression(expr)`

Extrai tabelas referenciadas em atributos qualificados, como `Produto.Preco`.

### `isWrapped(s)`

Verifica se uma expressão inteira está envolvida por um par externo de parênteses.

### `findOperatorIndex(expr, op)`

Encontra a posição de um operador de comparação fora de parênteses.

### `extractAndValidateJoins(sql, usedTables, errors)`

Extrai e valida blocos `JOIN ... ON ...`.

Verifica:

- tabela do `JOIN`;
- ausência de apelido;
- existência de `ON`;
- condição do `ON`;
- conexão entre a tabela nova e uma tabela já declarada.

Retorna os joins validados no formato:

```js
{ table, condition }
```

### `canonicalSelectAttr(col, usedTables)`

Gera uma forma canônica para atributos do `SELECT`. Ajuda a detectar duplicidades, inclusive quando um atributo aparece uma vez qualificado e outra vez sem qualificação.

### `hasInvalidSymbolicOperator(expr)`

Detecta símbolos e combinações de operadores fora do escopo, como:

- `!=`;
- `==`;
- `*=`;
- `%>`;
- operadores aritméticos isolados.

## `scripts/parser.js`

Arquivo responsável pelo fluxo principal da HU1.

### `parse(rawSQL)`

Coordena toda a validação:

1. normaliza o SQL;
2. rejeita recursos fora do escopo;
3. valida a estrutura mínima `SELECT ... FROM ...`;
4. extrai tabelas declaradas em `FROM` e `JOIN`;
5. valida parênteses;
6. valida atributos do `SELECT`;
7. valida blocos `JOIN`;
8. valida `WHERE`;
9. gera `parsed` quando não há erros.

Retorna:

```js
{
  errors,
  tokens,
  usedTables,
  parsed
}
```

## `scripts/algebra.js`

Arquivo responsável pela conversão para álgebra relacional e pela otimização lógica.

### `canonicalTableName(name)`

Retorna o nome canônico da tabela usando `schemaKey()`.

### `canonicalFieldName(tableName, fieldName)`

Retorna o nome canônico de um campo dentro de uma tabela.

### `qualifyAttr(tableName, fieldName)`

Monta um atributo qualificado no formato:

```text
Tabela.Campo
```

### `joinKind(cond)`

Classifica uma condição de junção:

- `equi`: igualdade simples entre dois atributos qualificados;
- `theta`: qualquer outra condição aceita.

### `makeRel(table)`

Cria um nó de relação:

```js
{ type: "rel", name: "Produto" }
```

### `toAlgebra(parsed)`

Converte o objeto `parsed` em uma árvore de álgebra relacional.

A árvore é criada nesta ordem:

1. relação base do `FROM`;
2. junções;
3. seleção `sigma` do `WHERE`;
4. projeção `pi` do `SELECT`.

Retorna expressão em texto, expressão em HTML, passos explicativos e árvore final.

### `treeToText(n)`

Converte a árvore de álgebra para texto simples.

### `treeToHtml(n)`

Converte a árvore para HTML com classes CSS usadas pela interface.

### `relLabel(n)`

Retorna o rótulo de uma relação. Atualmente retorna o nome da tabela.

### `deepCopy(o)`

Cria cópia profunda de objetos simples usando JSON.

### `optimizeTree(tree)`

Coordena a otimização lógica. Retorna:

- `optimizedTree`;
- `optSteps`.

As heurísticas principais são:

- empurrar seleções para perto das relações;
- preservar condições que dependem de mais de uma tabela;
- reordenar visualmente junções quando possível;
- inserir projeções intermediárias;
- reconstruir a projeção final.

### `extractTopSigma(node)`

Remove seleções `sigma` no topo da árvore e separa suas condições usando `splitByAnd()`.

### `referencedTables(expr)`

Retorna tabelas referenciadas em atributos qualificados. Internamente reaproveita `referencedTablesInExpression()`.

### `conditionBelongsToSingleRelation(cond, relations)`

Verifica se uma condição pertence a uma única relação.

### `inferSingleRelationForCondition(cond, relations)`

Tenta descobrir a relação associada a uma condição. Funciona com atributos qualificados e também tenta inferir atributos simples quando não há ambiguidade.

### `collectRelations(node, list)`

Percorre a árvore e coleta nós `rel`.

### `tableNamesInTree(node)`

Retorna nomes das tabelas presentes em uma árvore ou subárvore.

### `pushSelectionsToRelations(node, whereConds, steps)`

Empurra seleções para perto das relações correspondentes quando a condição referencia uma tabela de forma qualificada.

Retorna:

- nova árvore;
- conjunto de condições aplicadas.

### `collectJoinConditions(node, list)`

Coleta condições dos nós de junção.

### `collectRequiredAttributes(tree, finalAttrs)`

Calcula quais atributos precisam ser preservados em cada tabela.

Considera:

- atributos do `SELECT`;
- atributos usados em `JOIN`;
- atributos usados em seleções ainda relevantes acima de subárvores.

### `collectSigmaNodes(node, list)`

Coleta todos os nós `sigma`.

### `collectSigmaConditions(node, list)`

Coleta apenas as condições dos nós `sigma`.

### `applyIntermediateProjections(node, finalAttrs, steps)`

Insere projeções intermediárias nas relações ou seleções sobre relações, mantendo somente atributos necessários.

### `relationScore(node)`

Calcula uma pontuação simples para orientar a reordenação visual de junções. Subárvores com seleção recebem peso maior.

### `reorderJoinTree(node, steps)`

Percorre a árvore e tenta reorganizar junções quando isso não quebra as dependências lógicas. Também registra passos explicativos.

## `scripts/grafo.js`

Arquivo responsável por representar a árvore de álgebra como grafo.

### `escHtml(s)`

Escapa caracteres especiais de HTML.

### `formatGraphLabel(value, type)`

Formata rótulos exibidos nos nós do grafo.

### `astToGraph(tree)`

Converte a árvore em uma estrutura de grafo:

- `nodes`;
- `edges`;
- `rootId`.

### `NODE_META`

Configuração visual dos tipos de nó:

- classe CSS;
- símbolo exibido;
- função que extrai o rótulo.

### `buildGraphHtml(node)`

Renderiza recursivamente a árvore como HTML.

### `getGraphZoomClass(graphOrTree)`

Escolhe uma classe de zoom com base na quantidade de nós.

### `renderGrafo(tree, graph)`

Monta o painel da HU3 com desenho da árvore, tabela de nós e tabela de arestas.

## `scripts/plano.js`

Arquivo responsável pelo plano lógico de execução.

### `formatRelForPlan(node)`

Retorna o nome da relação para exibição no plano.

### `astToExecutionPlan(node, plan)`

Percorre a árvore em pós-ordem, visitando filhos antes do operador atual.

Gera passos como:

- acessar tabela;
- aplicar seleção;
- realizar equijunção;
- realizar junção theta;
- aplicar projeção.

### `renderPlanoExecucao(tree)`

Renderiza o plano como lista numerada na interface.

## `scripts/app.js`

Arquivo que integra interface, parser, álgebra, grafo, otimização e plano.

### `buildSchema()`

Monta o painel lateral do modelo de dados a partir de `SCHEMA`.

### `renderAlgebra(result)`

Renderiza a aba de álgebra relacional.

### `toggleStep(el)`

Abre ou fecha um card de passo.

### `renderOtimizacao(optResult, optimizedGraph)`

Renderiza a árvore otimizada, os passos de otimização e o grafo otimizado.

### `renderValidacao(errors, tokens, usedTables)`

Renderiza o resultado da validação.

### `lastExprText`

Guarda a última expressão textual de álgebra para o botão de copiar.

### `processar()`

Função principal da aplicação.

Fluxo:

1. lê o SQL do editor;
2. chama `parse(sql)`;
3. renderiza a validação;
4. bloqueia etapas seguintes se houver erro;
5. chama `toAlgebra(parsed)`;
6. gera e renderiza o grafo;
7. otimiza a árvore;
8. gera o grafo otimizado;
9. gera o plano de execução.

### `initGraphPanAndCenter()`

Inicializa navegação por arraste e centralização dos grafos.

### `centerGraphViewport(el)`

Centraliza horizontalmente a área rolável do grafo quando necessário.

### `enableGraphPan(el)`

Permite clicar e arrastar o painel do grafo.

### `copiarAlgebra()`

Copia a expressão de álgebra relacional para a área de transferência.

### `switchTab(name)`

Alterna entre as abas da interface.

### `esc(s)`

Escapa caracteres HTML.

### `limpar()`

Limpa o editor e restaura os painéis para o estado inicial.

### `loadEx(i)`

Carrega uma consulta da lista `EXAMPLES` no editor.

## Resumo do fluxo

```text
Usuário clica em Processar
  -> app.js: processar()
  -> parser.js: parse()
  -> app.js: renderValidacao()
  -> algebra.js: toAlgebra()
  -> grafo.js: astToGraph()
  -> grafo.js: renderGrafo()
  -> algebra.js: optimizeTree()
  -> app.js: renderOtimizacao()
  -> plano.js: renderPlanoExecucao()
```

Se `parse()` retornar erros, o fluxo para na validação e as abas seguintes pedem a correção da consulta.
