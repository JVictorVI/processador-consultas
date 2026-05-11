# Funções do Projeto

Este documento explica as principais constantes e funções criadas em cada arquivo do projeto. A aplicação usa JavaScript carregado diretamente no navegador, então as funções ficam no escopo global e são compartilhadas entre os arquivos conforme a ordem definida em `index.html`.

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

Essa ordem é importante porque arquivos posteriores usam dados e funções definidos nos arquivos anteriores.

## `scripts/schema.js`

Arquivo de configuração do modelo de dados e exemplos da aplicação.

### `SCHEMA`

Objeto que descreve o banco de dados usado pelo processador. Cada chave representa uma tabela e possui:

- `pk`: chave primária da tabela;
- `fields`: lista de atributos disponíveis.

É usado pelo parser para validar tabelas e campos, pela interface para montar o painel "Modelo de Dados" e pela álgebra para expandir `SELECT *`.

### `FK_FIELDS`

Lista de campos tratados como chaves estrangeiras. É usada principalmente na interface para destacar visualmente esses atributos no painel do schema.

### `RESERVED`

Conjunto de palavras reservadas SQL conhecidas pela aplicação. Ajuda o parser a diferenciar identificadores comuns de palavras da linguagem.

### `CMP_OPS`

Lista dos operadores de comparação aceitos:

```text
<>, >=, <=, =, >, <
```

A ordem evita ambiguidade ao procurar operadores compostos antes dos simples.

### `EXAMPLES`

Lista de consultas SQL usadas pelos botões de exemplo do editor. Inclui consultas válidas e consultas com erro para testar a validação.

## `scripts/parserUtils.js`

Arquivo responsável pelos utilitários usados pelo parser. Ele precisa ser carregado depois de `schema.js` e antes de `parser.js`, porque depende das constantes do schema e fornece funções usadas pela validação principal.

### `schemaKey(name)`

Procura uma tabela no `SCHEMA` ignorando diferença entre maiúsculas e minúsculas. Retorna o nome canônico da tabela ou `null`.

Exemplo: `produto` retorna `Produto`.

### `isReserved(word)`

Verifica se uma palavra está no conjunto `RESERVED`.

### `isLiteral(tok)`

Verifica se um token é um literal aceito pelo projeto:

- número inteiro;
- número decimal;
- texto entre aspas simples.

### `isIdentifier(tok)`

Verifica se um token tem formato de identificador SQL simples e não é literal.

### `cleanSqlInput(sql)`

Normaliza a consulta digitada:

- remove ponto e vírgula final;
- troca sequências de espaços por um único espaço;
- remove espaços no início e no fim.

### `tokenize(sql)`

Divide a consulta em tokens para exibição e classificação. Reconhece identificadores, atributos qualificados, operadores, parênteses, vírgulas, asterisco, números e strings.

### `validateCondition(condRaw, usedTables, errors, ctx)`

Valida uma condição de `WHERE` ou `ON`.

Ela verifica:

- parênteses balanceados;
- uso inválido de `AND`;
- predicados separados por `AND`;
- operandos e operadores de cada comparação.

O parâmetro `ctx` indica se a validação acontece na cláusula `WHERE` ou `ON`, para gerar mensagens de erro mais claras.

### `splitByAnd(cond)`

Divide uma condição pelos conectivos `AND` de nível superior. A função respeita parênteses, então não divide um `AND` que esteja dentro de `(...)`.

### `validateAtom(atom, usedTables, errors, ctx)`

Valida um predicado atômico, como:

```sql
Produto.Preco > 50
```

Ela identifica o operador de comparação, separa operando esquerdo e direito e chama `validateOperand()` para cada lado.

### `findTablesContainingAttribute(attr, usedTables)`

Procura, entre as tabelas declaradas na consulta, quais possuem determinado atributo. É usada para detectar atributos inexistentes ou ambíguos.

### `isWrapped(s)`

Verifica se uma expressão está completamente envolvida por um par de parênteses externos.

Exemplo:

- `(A = B)` retorna verdadeiro;
- `(A) = (B)` retorna falso.

### `findOperatorIndex(expr, op)`

Encontra a posição de um operador de comparação em uma expressão, considerando apenas operadores fora de parênteses.

### `validateOperand(tok, usedTables, errors, ctx)`

Valida um operando de comparação. O operando pode ser:

- literal numérico;
- literal texto;
- atributo qualificado, como `Cliente.Nome`;
- atributo simples, como `Nome`.

Também verifica se a tabela foi declarada no `FROM` ou `JOIN` e se o atributo existe.

### `extractAndValidateJoins(sql, usedTables, errors)`

Extrai todos os blocos `JOIN ... ON ...` da consulta e valida:

- tabela do `JOIN`;
- ausência de apelido;
- existência da cláusula `ON`;
- condição do `ON`;
- conexão entre a tabela nova e alguma tabela já declarada.

Retorna uma lista de joins com tabela e condição.

## `scripts/parser.js`

Arquivo responsável pela validação sintática e semântica principal da consulta SQL. Ele coordena o fluxo da HU1 usando os utilitários de `parserUtils.js`.

### `parse(rawSQL)`

Função principal do parser. Coordena toda a HU1.

Fluxo geral:

1. normaliza o SQL;
2. rejeita recursos fora do escopo;
3. valida a estrutura mínima `SELECT ... FROM ...`;
4. extrai tabelas do `FROM` e dos `JOINs`;
5. valida parênteses;
6. valida atributos do `SELECT`;
7. valida joins;
8. valida `WHERE`;
9. se estiver tudo certo, gera o objeto `parsed`.

Retorna:

```js
{
  errors,
  tokens,
  usedTables,
  parsed
}
```

### `canonicalSelectAttr(col, usedTables)`

Gera uma forma canônica para um atributo do `SELECT`. Ajuda a detectar atributos duplicados, inclusive quando um atributo aparece qualificado e não qualificado.

### `hasInvalidSymbolicOperator(expr)`

Detecta símbolos e combinações de operadores que estão fora do escopo, como `%`, `*=`, `!=`, `==` e outros usos inválidos.

### `classifyTok(tok)`

Classifica um token para a interface:

- palavra-chave;
- tabela;
- atributo;
- operador;
- outro.

Essa função é usada pela renderização da validação para colorir os tokens encontrados.

## `scripts/algebra.js`

Arquivo responsável pela conversão para álgebra relacional e pela otimização lógica.

### `cleanSqlInputForAlgebra(sql)`

Normaliza o SQL para uso na etapa de álgebra. Se `cleanSqlInput()` existir, reutiliza a função do parser.

### `canonicalTableName(name)`

Retorna o nome canônico da tabela usando `schemaKey()`. Se a tabela não existir no schema, retorna o próprio nome recebido.

### `canonicalFieldName(tableName, fieldName)`

Retorna o nome canônico de um campo dentro de uma tabela. Evita problemas com diferenças de caixa.

### `qualifyAttr(tableName, fieldName)`

Monta um atributo qualificado no formato:

```text
Tabela.Campo
```

### `extractParsed(sql, usedTables)`

Extrai uma estrutura simplificada da consulta para a etapa de álgebra:

- colunas do `SELECT`;
- tabela do `FROM`;
- joins;
- condição do `WHERE`;
- tabelas usadas.

É chamada pelo parser quando a consulta está válida.

### `joinKind(cond)`

Identifica se uma condição de join é uma equijunção ou uma junção theta.

- equijunção: igualdade simples entre dois atributos qualificados;
- theta: qualquer outra condição aceita.

### `makeRel(table)`

Cria um nó de relação da árvore de álgebra:

```js
{ type: "rel", name: "Produto" }
```

### `toAlgebra(parsed)`

Converte o objeto `parsed` em uma árvore de álgebra relacional.

A árvore é criada nesta ordem:

1. relação base do `FROM`;
2. joins;
3. seleção `sigma` do `WHERE`;
4. projeção `pi` do `SELECT`.

Também gera:

- texto da expressão;
- HTML da expressão;
- passos explicativos;
- árvore final.

### `treeToText(n)`

Converte uma árvore de álgebra para texto simples. É usado, por exemplo, para copiar a expressão gerada.

### `treeToHtml(n)`

Converte uma árvore de álgebra para HTML com classes CSS, permitindo destacar operadores, atributos e relações na interface.

### `relLabel(n)`

Retorna o rótulo de uma relação. Atualmente retorna o nome da tabela.

### `deepCopy(o)`

Cria uma cópia profunda de objetos simples usando JSON. É usada para salvar estados intermediários da árvore sem modificar os passos já registrados.

### `optimizeTree(tree)`

Função principal da otimização. Recebe a árvore original e devolve:

- `optimizedTree`: árvore otimizada;
- `optSteps`: passos explicativos da otimização.

As principais heurísticas são:

- empurrar seleções para perto das tabelas;
- preservar filtros que dependem de mais de uma tabela;
- reordenar visualmente joins quando possível;
- inserir projeções intermediárias;
- reconstruir a projeção final.

### `extractTopSigma(node)`

Remove seleções `sigma` no topo da árvore e separa suas condições. Isso permite tentar empurrar essas condições para as relações corretas.

### `splitWhereConditions(cond)`

Divide uma condição de `WHERE` em partes separadas por `AND`. Usa `splitByAnd()` do parser quando disponível.

### `referencedTables(expr)`

Retorna as tabelas referenciadas em uma expressão com atributos qualificados.

Exemplo: em `Produto.Preco > 50`, retorna `Produto`.

### `conditionBelongsToSingleRelation(cond, relations)`

Verifica se uma condição pertence a uma única relação. Internamente usa `inferSingleRelationForCondition()`.

### `inferSingleRelationForCondition(cond, relations)`

Tenta descobrir a tabela associada a uma condição. Funciona com atributos qualificados e também tenta inferir atributos simples quando não há ambiguidade.

### `collectRelations(node, list)`

Percorre a árvore e coleta todos os nós do tipo `rel`.

### `tableNamesInTree(node)`

Retorna apenas os nomes das tabelas encontradas em uma árvore ou subárvore.

### `pushSelectionsToRelations(node, whereConds, steps)`

Empurra condições de seleção para perto das relações correspondentes. Por exemplo, uma condição sobre `Produto.Preco` pode ser aplicada diretamente sobre a relação `Produto`.

Retorna a nova árvore e o conjunto de condições aplicadas.

### `collectJoinConditions(node, list)`

Percorre a árvore e coleta as condições dos joins.

### `collectRequiredAttributes(tree, finalAttrs)`

Calcula quais atributos precisam ser preservados em cada tabela para que o plano continue correto. Considera:

- atributos do `SELECT`;
- atributos usados nos `JOINs`;
- atributos usados em seleções que ainda precisam subir na árvore.

### `collectSigmaNodes(node, list)`

Coleta todos os nós `sigma` da árvore.

### `collectSigmaConditions(node, list)`

Coleta apenas as condições dos nós `sigma`.

### `applyIntermediateProjections(node, finalAttrs, steps)`

Insere projeções intermediárias nas relações ou seleções sobre relações, mantendo somente os atributos necessários.

Essa heurística reduz a quantidade de colunas carregadas nas etapas seguintes.

### `relationScore(node)`

Calcula uma pontuação simples para uma relação ou subárvore. Subárvores com seleção recebem peso maior, para orientar a reordenação visual de joins.

### `reorderJoinTree(node, steps)`

Percorre a árvore e tenta reorganizar joins quando isso não quebra as dependências lógicas. Também registra passos explicativos quando um join é preservado ou reordenado.

## `scripts/grafo.js`

Arquivo responsável por representar a árvore de álgebra como grafo visual e como estrutura em memória.

### `escHtml(s)`

Escapa caracteres especiais de HTML, como `&`, `<` e `>`, antes de inserir textos na interface.

### `formatGraphLabel(value, type)`

Formata o rótulo exibido em cada nó do grafo. Pode quebrar linhas em listas de atributos, condições com `AND` e operadores de comparação.

### `astToGraph(tree)`

Converte a árvore de álgebra em um grafo em memória.

Gera:

- `nodes`: nós com id, tipo e rótulo;
- `edges`: arestas entre resultados intermediários;
- `rootId`: id do nó raiz.

### `NODE_META`

Objeto de configuração visual dos tipos de nó:

- classe CSS;
- símbolo exibido;
- função que extrai o rótulo.

### `buildGraphHtml(node)`

Renderiza recursivamente a árvore como HTML. Cria caixas para operadores e relações, além das linhas/conectores entre os nós.

### `getGraphZoomClass(graphOrTree)`

Escolhe uma classe de zoom para o grafo com base na quantidade de nós. Grafos maiores recebem escala menor para caber melhor na tela.

### `renderGrafo(tree, graph)`

Monta todo o painel da HU3:

- dica de leitura do grafo;
- árvore visual;
- tabela de nós;
- tabela de arestas.

## `scripts/plano.js`

Arquivo responsável por transformar a árvore otimizada em plano lógico de execução.

### `formatRelForPlan(node)`

Retorna o nome da relação para exibição no plano. Usa `relLabel()` quando essa função está disponível.

### `astToExecutionPlan(node, plan)`

Percorre a árvore em pós-ordem, isto é, visita filhos antes do operador atual. Isso gera uma ordem de execução de baixo para cima.

Para cada nó, cria uma descrição:

- acessar tabela;
- aplicar seleção;
- realizar equijunção;
- realizar junção theta;
- aplicar projeção.

### `renderPlanoExecucao(tree)`

Renderiza o plano como uma lista numerada na interface, usando a saída de `astToExecutionPlan()`.

## `scripts/app.js`

Arquivo responsável por integrar interface, parser, álgebra, grafo, otimização e plano.

### `buildSchema()`

Monta o painel lateral do modelo de dados a partir do objeto `SCHEMA`. Para cada tabela, cria um card expansível com seus atributos, destacando chaves primárias e estrangeiras.

### `renderAlgebra(result)`

Renderiza a aba de álgebra relacional. Exibe:

- expressão final;
- passos de construção;
- árvore de cada passo.

### `toggleStep(el)`

Abre ou fecha o corpo de um card de passo na interface.

### `renderOtimizacao(optResult, optimizedGraph)`

Renderiza a aba de otimização. Mostra:

- árvore otimizada;
- passos aplicados;
- grafo otimizado.

### `renderValidacao(errors, tokens, usedTables)`

Renderiza o resultado da validação. Se houver erros, mostra a lista de problemas. Se não houver, mostra sucesso, tokens identificados e tabelas referenciadas.

### `lastExprText`

Variável que guarda a última expressão de álgebra em texto puro. É usada pelo botão de copiar.

### `processar()`

Função principal da aplicação. É chamada ao clicar no botão "Processar".

Fluxo:

1. lê o SQL do editor;
2. chama `parse(sql)`;
3. renderiza a validação;
4. se houver erro, bloqueia as outras etapas;
5. se estiver válido, chama `toAlgebra(parsed)`;
6. gera e renderiza o grafo com `astToGraph()`;
7. otimiza a árvore com `optimizeTree()`;
8. gera o grafo otimizado;
9. gera o plano com `renderPlanoExecucao()`.

### `initGraphPanAndCenter()`

Inicializa os comportamentos dos painéis de grafo:

- arrastar para navegar;
- centralização horizontal inicial.

### `centerGraphViewport(el)`

Centraliza horizontalmente a área rolável do grafo quando necessário. Também evita esconder a raiz em grafos altos.

### `enableGraphPan(el)`

Permite clicar e arrastar o painel do grafo para navegar pela árvore quando ela ultrapassa o tamanho visível.

### `copiarAlgebra()`

Copia a expressão de álgebra relacional para a área de transferência e muda temporariamente o texto do botão para indicar sucesso.

### `switchTab(name)`

Alterna entre as abas:

- validação;
- álgebra;
- grafo;
- otimização;
- plano.

### `esc(s)`

Escapa caracteres HTML para evitar inserir texto bruto perigoso ou quebrar a interface.

### `limpar()`

Limpa o editor e restaura todos os painéis para o estado inicial.

Também redefine:

- contador de caracteres;
- numeração de linhas;
- indicadores coloridos;
- botão de copiar.

### `loadEx(i)`

Carrega no editor uma consulta da lista `EXAMPLES`, usando o índice recebido. Também atualiza numeração de linhas e contador de caracteres.

## Resumo do fluxo entre funções

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

Se `parse()` retornar erros, o fluxo para na validação e as abas seguintes exibem mensagens solicitando correção da consulta.
