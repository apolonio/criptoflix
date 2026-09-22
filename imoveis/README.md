# Gestão Casa

Aplicação familiar para gestão de imóveis, patrimônio, receitas, despesas,
manutenções, documentos, obrigações fiscais e contratos.

## Estrutura

- `app/`: autenticação e APIs do Site.
- `public/gestao/`: interface principal preservada da versão original.
- `db/` e `drizzle/`: pessoas autorizadas e estado compartilhado.
- D1: dados compartilhados entre usuários.
- R2: PDFs e imagens dos imóveis.
- armazenamento local: contingência para uso sem conexão.

## Desenvolvimento

```powershell
npm run dev
```

A versão local simula o login do Site. A publicação usa o login gerenciado pelo
ChatGPT/Sites e não armazena senhas na aplicação.

## Cópia no GitHub

O código desta pasta foi exportado do projeto Gestão Casa no Sites. Os dados
exibidos no exemplo foram anonimizados para publicação neste repositório público.
Os registros reais, imagens enviadas, documentos e usuários ficam no armazenamento
do Site e não fazem parte deste repositório. Alterações aqui não são publicadas
automaticamente no Sites.
