# Roteiro de Apresentação do Processador de Consultas

Este roteiro segue a ordem dos critérios de avaliação. A ideia é explicar primeiro o que o usuário vê na interface e, em seguida, mostrar onde isso está codificado em cada arquivo.

## 1. Parsing e Validação Correta

Comece pela aba **Validação (HU1)**.

Explique que o processamento começa quando o usuário digita uma consulta SQL no editor e clica em **Processar**. Esse clique chama a função principal da interface:

```js
processar()
```

Arquivo:

```text
scripts/app.js
```

Dentro de `processar()`, a primeira etapa é ler o conteúdo do editor e chamar:

```js
parse(sql)
```

Arquivo:

```text
scripts/parser.js
```

Essa função é o centro do parsing e da validação. Ela recebe a consulta bruta, coordena a validação e verifica se a consulta está dentro do subconjunto SQL aceito pelo projeto.

Também comente que, depois da refatoração, os utilitários usados por `parse()` foram separados em:

```text
scripts/parserUtils.js
```

Por isso a ordem correta no `index.html` ficou:

```text
schema.js -> parserUtils.js -> parser.js -> algebra.js -> grafo.js -> plano.js -> app.js
```

Explique que `schema.js` vem primeiro porque define `SCHEMA`, `RESERVED` e `CMP_OPS`; `parserUtils.js` vem em seguida porque usa essas constantes; e `parser.js` vem depois porque usa os utilitários.

### O que mostrar na execução

Use primeiro uma consulta válida:

```sql
SELECT idProduto, Nome, Preco
FROM Produto
```

Mostre que a interface identifica:

- consulta válida;
- tokens encontrados;
- tabelas referenciadas;
- ausência de erros.

Depois use uma consulta inválida:

```sql
SELECT CPF, Nome
FROM Cliente
```

Explique que o parser encontra erro porque `CPF` não existe na tabela `Cliente`, de acordo com o modelo em `SCHEMA`.

### Como a validação foi codificada

Mostre que o projeto usa principalmente expressões regulares e validações manuais por etapas.

Funções importantes:

No arquivo:

```text
scripts/parserUtils.js
```

```js
cleanSqlInput(sql)
```

Normaliza a consulta:

- remove `;` no final;
- reduz espaços repetidos;
- remove espaços no início e no fim.

```js
tokenize(sql)
```

Quebra a consulta em tokens, usando expressão regular para identificar palavras, atributos qualificados, operadores, parênteses, vírgulas, números e strings.

```js
schemaKey(name)
```

Procura uma tabela no schema ignorando maiúsculas/minúsculas.

```js
validateCondition(condRaw, usedTables, errors, ctx)
```

Valida condições de `WHERE` e `ON`. Ela confere:

- parênteses balanceados;
- uso correto de `AND`;
- predicados separados corretamente;
- operadores de comparação;
- presença dos operandos.

```js
validateAtom(atom, usedTables, errors, ctx)
```

Valida uma comparação individual, por exemplo:

```sql
Produto.Preco > 50
```

```js
extractAndValidateJoins(sql, usedTables, errors)
```

Extrai e valida os blocos `JOIN ... ON ...`.

No arquivo:

```text
scripts/parser.js
```

```js
parse(rawSQL)
```

Coordena a validação completa:

1. chama `cleanSqlInput()`;
2. rejeita recursos fora do escopo;
3. valida estrutura básica `SELECT ... FROM ...`;
4. extrai tabelas de `FROM` e `JOIN`;
5. valida atributos do `SELECT`;
6. chama `extractAndValidateJoins()`;
7. chama `validateCondition()` para o `WHERE`;
8. se não houver erros, chama `extractParsed()` para montar o objeto usado pela álgebra relacional.

```js
canonicalSelectAttr(col, usedTables)
```

Ajuda a detectar atributos duplicados no `SELECT`.

```js
hasInvalidSymbolicOperator(expr)
```

Detecta combinações simbólicas fora do escopo, como `!=`, `==`, `*=`, `%>` e semelhantes.

```js
classifyTok(tok)
```

Classifica tokens para a exibição colorida da aba de validação.

### Pontos para comentar

Diga que o parser não apenas procura palavras no texto. Ele também valida o SQL contra o modelo de dados definido em:

```text
scripts/schema.js
```

O objeto principal é:

```js
SCHEMA
```

Ele contém as tabelas e os atributos permitidos. Por isso o sistema consegue saber se uma tabela existe, se um campo existe e se um atributo está ambíguo.

Também vale comentar que recursos fora do escopo são rejeitados de propósito, como:

- `OR`;
- `LIKE`;
- `GROUP BY`;
- `ORDER BY`;
- funções de agregação;
- subconsultas;
- apelidos de tabela.

## 2. Conversão para Álgebra Relacional

Depois da validação, vá para a aba **Álgebra Relacional (HU2)**.

Explique que a conversão só acontece se `parse(sql)` não retornar erros. No arquivo `app.js`, dentro de `processar()`, o código chama:

```js
toAlgebra(parsed)
```

Arquivo:

```text
scripts/algebra.js
```

### O que mostrar na execução

Use a consulta:

```sql
SELECT Produto.Nome, Categoria.Descricao
FROM Produto
JOIN Categoria ON Produto.Categoria_idCategoria = Categoria.idCategoria
WHERE Produto.Preco > 50
```

Explique que ela é convertida para uma árvore lógica com operadores de álgebra relacional:

- `rel`: relação/tabela;
- `equi`: equijunção;
- `theta`: junção theta;
- `sigma`: seleção;
- `pi`: projeção.

### Como foi codificado

Função principal:

```js
toAlgebra(parsed)
```

Ela monta a árvore nesta ordem:

1. Cria a relação base do `FROM`.
2. Adiciona os `JOINs`.
3. Adiciona a seleção do `WHERE`.
4. Adiciona a projeção do `SELECT`.

Funções auxiliares:

```js
makeRel(table)
```

Cria um nó de relação.

```js
joinKind(cond)
```

Define se a junção é uma equijunção ou uma junção theta.

```js
treeToText(n)
```

Converte a árvore para texto.

```js
treeToHtml(n)
```

Converte a árvore para HTML, permitindo a exibição colorida na tela.

### Pontos para comentar

Explique que a consulta SQL deixa de ser apenas texto e passa a ser uma estrutura de dados em árvore. Essa árvore é o que permite gerar grafo, otimizar e montar o plano de execução.

## 3. Exibição do Grafo de Operadores Otimizado

Depois mostre as abas **Grafo de Operadores (HU3)** e **Otimização (HU4)**.

Primeiro, a árvore de álgebra é transformada em grafo com:

```js
astToGraph(tree)
```

Arquivo:

```text
scripts/grafo.js
```

Depois, a árvore é otimizada:

```js
optimizeTree(result.tree)
```

Arquivo:

```text
scripts/algebra.js
```

Em seguida, o grafo otimizado é gerado novamente:

```js
astToGraph(optResult.optimizedTree)
```

E renderizado dentro da aba de otimização por:

```js
renderOtimizacao(optResult, optimizedGraph)
```

Arquivo:

```text
scripts/app.js
```

### O que mostrar na execução

Use a consulta com `JOIN` e `WHERE`. Mostre que:

- as tabelas aparecem como folhas;
- os operadores aparecem como nós intermediários;
- a projeção aparece no topo;
- a leitura é de baixo para cima;
- a aba de otimização mostra a árvore otimizada e o grafo otimizado.

### Como foi codificado

Funções principais do grafo:

```js
astToGraph(tree)
```

Percorre a árvore e gera:

- lista de nós;
- lista de arestas;
- identificador do nó raiz.

```js
buildGraphHtml(node)
```

Monta visualmente o grafo como HTML.

```js
renderGrafo(tree, graph)
```

Renderiza o painel do grafo com:

- desenho da árvore;
- tabela de nós;
- tabela de arestas.

```js
getGraphZoomClass(graphOrTree)
```

Ajusta a escala visual quando o grafo tem muitos nós.

### Pontos para comentar

Diga que o grafo não é desenhado manualmente para cada consulta. Ele é gerado dinamicamente a partir da árvore de operadores.

## 4. Ordem de Execução Apresentada

Vá para a aba **Plano de Execução (HU5)**.

Explique que o plano é gerado a partir da árvore otimizada, não da árvore original. No final de `processar()`, o código chama:

```js
renderPlanoExecucao(optResult.optimizedTree)
```

Arquivo:

```text
scripts/plano.js
```

### Como foi codificado

Função principal:

```js
astToExecutionPlan(node, plan = [])
```

Ela percorre a árvore em pós-ordem, ou seja:

1. primeiro visita os filhos;
2. depois visita o operador atual.

Isso gera uma ordem natural de execução de baixo para cima.

Depois o plano é exibido com:

```js
renderPlanoExecucao(tree)
```

### O que comentar

Explique que a ordem costuma aparecer assim:

1. acessar relações/tabelas;
2. aplicar seleções;
3. realizar junções;
4. aplicar projeções.

Esse plano não executa em um banco real. Ele representa a ordem lógica em que as operações seriam aplicadas.

## 5. Heurística de Redução de Tuplas

Agora volte para a aba **Otimização (HU4)** e explique a primeira heurística.

A redução de tuplas acontece quando filtros do `WHERE` são aplicados o mais cedo possível. Em álgebra relacional, isso significa empurrar operadores de seleção `sigma` para perto das relações.

### Funções envolvidas

```js
optimizeTree(tree)
```

Coordena toda a otimização.

```js
extractTopSigma(node)
```

Separa as condições de seleção que estão no topo da árvore.

```js
splitWhereConditions(cond)
```

Divide condições compostas por `AND`.

```js
pushSelectionsToRelations(node, whereConds, steps)
```

Aplica a heurística de redução de tuplas. Ela tenta colocar cada condição diretamente sobre a tabela correspondente.

### Como explicar

Use o exemplo:

```sql
SELECT Produto.Nome, Categoria.Descricao
FROM Produto
JOIN Categoria ON Produto.Categoria_idCategoria = Categoria.idCategoria
WHERE Produto.Preco > 50
```

O filtro:

```sql
Produto.Preco > 50
```

depende apenas da tabela `Produto`. Então a otimização pode aplicar esse filtro antes da junção com `Categoria`.

Explique assim:

> Em vez de juntar todos os produtos com categorias e só depois filtrar, o sistema filtra primeiro os produtos com preço maior que 50. Isso reduz a quantidade de tuplas que chegam na junção.

### Pontos para comentar

A função `pushSelectionsToRelations()` verifica a tabela da condição e cria um nó `sigma` próximo da relação correta. Isso mostra a aplicação da heurística de redução de tuplas.

## 6. Heurística de Redução de Atributos

Depois explique a segunda heurística: reduzir colunas desnecessárias.

A ideia é manter, durante a execução intermediária, apenas os atributos que serão necessários para:

- o `SELECT` final;
- as condições de `WHERE`;
- as condições de `JOIN`.

### Funções envolvidas

```js
collectRequiredAttributes(tree, finalAttrs)
```

Calcula quais atributos precisam ser preservados em cada tabela.

```js
collectJoinConditions(node, list)
```

Coleta atributos usados nas junções.

```js
collectSigmaNodes(node, list)
```

Coleta seleções da árvore.

```js
applyIntermediateProjections(node, finalAttrs, steps)
```

Insere projeções intermediárias para manter apenas os atributos necessários.

### Como explicar

No exemplo:

```sql
SELECT Produto.Nome, Categoria.Descricao
FROM Produto
JOIN Categoria ON Produto.Categoria_idCategoria = Categoria.idCategoria
WHERE Produto.Preco > 50
```

A tabela `Produto` possui muitos campos, mas nem todos precisam seguir pelo plano. Para essa consulta, são importantes:

- `Produto.Nome`, porque aparece no `SELECT`;
- `Produto.Categoria_idCategoria`, porque aparece no `JOIN`;
- `Produto.Preco`, porque aparece no `WHERE`;
- `Categoria.Descricao`, porque aparece no `SELECT`;
- `Categoria.idCategoria`, porque aparece no `JOIN`.

Explique assim:

> A otimização remove atributos que não serão usados no resultado nem nas próximas operações. Isso reduz o tamanho dos resultados intermediários.

## 7. Codificação e Uso da Junção

Finalize explicando a junção, porque ela aparece desde o parsing até a álgebra, o grafo, a otimização e o plano.

### No parsing

A junção é validada em:

```js
extractAndValidateJoins(sql, usedTables, errors)
```

Arquivo:

```text
scripts/parserUtils.js
```

Essa função verifica:

- se existe uma tabela após o `JOIN`;
- se a tabela existe no `SCHEMA`;
- se existe `ON`;
- se a condição do `ON` é válida;
- se a junção conecta a nova tabela a alguma tabela já declarada.

### Na álgebra relacional

A junção é criada em:

```js
toAlgebra(parsed)
```

Para cada join encontrado no parser, a função cria um nó de junção:

```js
{ type: "equi", left, right, cond }
```

ou:

```js
{ type: "theta", left, right, cond }
```

A função que decide o tipo é:

```js
joinKind(cond)
```

Se a condição for igualdade simples entre dois atributos qualificados, o sistema classifica como equijunção. Caso contrário, classifica como junção theta.

### No grafo

No grafo, a junção aparece como nó intermediário. Ela recebe resultados das relações ou subárvores e produz um resultado intermediário para o próximo operador.

Funções envolvidas:

```js
astToGraph(tree)
buildGraphHtml(node)
renderGrafo(tree, graph)
```

### Na otimização

Na otimização, as junções são preservadas com suas condições para evitar produto cartesiano. A função:

```js
reorderJoinTree(node, steps)
```

pode reorganizar visualmente a árvore quando isso não quebra as dependências lógicas.

Também são coletadas as condições de junção por:

```js
collectJoinConditions(node, list)
```

Isso é importante para a redução de atributos, porque atributos usados em `JOIN` não podem ser removidos antes da hora.

### No plano de execução

No plano, a junção aparece como uma etapa:

```text
Realizar Equijunção
```

ou:

```text
Realizar Junção-theta
```

Ela é gerada em:

```js
astToExecutionPlan(node, plan)
```

## Fechamento da Apresentação

Finalize resumindo o fluxo completo:

```text
SQL digitado
  -> processar()
  -> parse()
  -> renderValidacao()
  -> toAlgebra()
  -> astToGraph()
  -> optimizeTree()
  -> renderOtimizacao()
  -> renderPlanoExecucao()
```

Frase final sugerida:

> O projeto mostra o caminho completo de uma consulta SQL dentro de um processador de consultas: primeiro valida a sintaxe e o modelo de dados, depois converte para álgebra relacional, gera a árvore de operadores, aplica heurísticas de otimização e finalmente apresenta a ordem lógica de execução.
