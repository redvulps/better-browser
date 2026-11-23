# AGY Better Browser

O agy abre e controla abas em um grupo **Agy** por conversa no perfil pareado do Chrome ou Brave. A skill `/better-browser` e uma regra global direcionam pedidos de interação com o navegador ao MCP `better-browser`. O comando explícito `/browser` continua sendo despachado pelo próprio agy.

## Instalar a skill no Agy

Na máquina onde você usa o Agy, execute o comando abaixo em qualquer pasta. A opção `-g` deixa a skill disponível em todos os projetos do Antigravity CLI.

```sh
npx skills add redvulps/agy-better-browser --skill better-browser -g -a antigravity-cli
```

Abra uma nova sessão do Agy e digite `/skills` para conferir se `better-browser` aparece na lista. Para usar `/better-browser`, o Agy também precisa do servidor MCP e da extensão no navegador.

## Configurar o MCP e a extensão

Com Node.js 22.13+ e o comando `agy` no PATH, compile o projeto e registre o servidor MCP com estes comandos.

```sh
git clone https://github.com/redvulps/agy-better-browser.git
cd agy-better-browser
npm ci
npm run build
agy mcp add better-browser "$(node -p process.execPath)" "$PWD/dist/mcp.js"
```

Para desenvolver a skill pelo código-fonte, a sequência no clone é `npm ci`, `npm run build` e `./scripts/install-agy.sh`. Esse fluxo já registra o MCP e vincula a skill e a regra global aos arquivos do clone.

No navegador que será controlado, abra a página de extensões, habilite o modo de desenvolvedor e carregue a pasta **dist/extension** como extensão descompactada. Para um navegador em outro computador, copie essa pasta para ele. O build contém os arquivos necessários para executar a extensão.

1. Abra a extensão. Se quiser, atribua um nome ao navegador e salve. O painel mostra o ID que também aparecerá na conversa.
2. Digite `/better-browser` sem argumentos. A skill lista as extensões anunciadas na ponte, inclusive navegadores ainda sem pareamento. No endereço padrão, o MCP inicia a ponte em loopback quando necessário. Ao iniciar pela primeira vez, a extensão pode levar alguns segundos para aparecer.
3. Escolha o navegador e envie o respectivo token no chat do agy, disponível em **Token de acesso → Mostrar token**. O MCP verifica o token com o navegador escolhido e só então o salva em arquivo local com modo 0600. O token persiste para as próximas sessões e um token incorreto não substitui o anterior. O texto enviado no chat pode ficar no histórico do cliente.
4. Peça ao agy para abrir um site. Ele cria a primeira aba em um grupo **Agy** e usa a sessão de login desse perfil. As próximas abas da conversa entram no mesmo grupo. **Pausar** suspende o controle e **Retomar** permite continuar.

Para uma extensão previamente carregada da mesma pasta, use **Recarregar** no cartão em `chrome://extensions` ou `brave://extensions`. Isso preserva o token existente. Se o navegador solicitar as novas permissões de grupos e acesso aos sites HTTP/HTTPS, confirme para ativar a versão 0.3. Se o navegador estiver em outro PC, copie os arquivos novos de **dist/extension** sobre a mesma pasta antes de recarregar. Reinicie qualquer ponte antiga iniciada manualmente e abra uma nova sessão do agy para carregar as novas ferramentas do MCP.

Para manter o token fora da conversa, o cadastro por terminal continua disponível no Linux:

```sh
systemd-ask-password "Token Better Browser" | npm run --silent pair
```

## Computadores diferentes

A extensão inicia um WebSocket de saída para a máquina da ponte. O navegador valida o certificado TLS do endereço configurado. Em uma rede com vários PCs, use um nome DNS com certificado confiável. Exemplo para uma ponte chamada `agente.exemplo.net`:

```sh
BETTER_BROWSER_HOST=0.0.0.0 BETTER_BROWSER_PORT=8717 \
BETTER_BROWSER_CERT=/caminho/fullchain.pem BETTER_BROWSER_KEY=/caminho/privkey.pem \
npm run bridge
agy mcp add --env BETTER_BROWSER_URL=https://agente.exemplo.net:8717 better-browser \
  "$(node -p process.execPath)" "$PWD/dist/mcp.js"
```

No painel da extensão, use `wss://agente.exemplo.net:8717/browser`. O Node que executa o MCP também precisa confiar no certificado. Para uma CA privada, passe `--env NODE_EXTRA_CA_CERTS=/caminho/ca.pem` no comando `agy mcp add`. Também é possível manter a ponte no loopback e encaminhar o caminho `/browser` por um proxy HTTPS com suporte a WebSocket. Nessa configuração o MCP local usa sua URL padrão.

## Controle e histórico

A extensão mantém o token no armazenamento local e comprova sua posse por desafio HMAC mútuo com a ponte. O MCP autentica cada pedido na ponte com o mesmo token. A porta de depuração do navegador pode permanecer fechada. A ponte lista por ID as extensões online. A descoberta divulga somente o nome e o ID, inclusive quando o controle está pausado. Cada comando exige o token do navegador escolhido. A ponte valida a prova de posse enviada pela extensão e a extensão verifica a prova da ponte antes de executar a ação.

**Pausar** bloqueia os comandos de todas as conversas até você clicar em **Retomar**. **Renovar token** revoga a credencial e o acesso aos grupos atuais. A extensão mantém as últimas 200 ações com horário, origem e resultado.

Com a ponte conectada e pelo menos uma aba sob controle, aparece **Agy está controlando esse navegador** nas páginas HTTP e HTTPS em que a extensão tem acesso, inclusive nas abas pessoais. O aviso acompanha trocas de aba e navegações. Nas páginas internas e em outros endereços protegidos, o ícone da extensão mostra **AGY** e a frase aparece ao passar o ponteiro. Fixe o ícone na barra para vê-lo nessas páginas. Pausar, desconectar a ponte ou retirar a última aba do controle apaga o aviso. Uma aba do grupo mantida aberta após uma tarefa mantém o aviso enquanto o controle estiver habilitado.

## Abas da sessão

Ao abrir um site com `open` ou `navigate`, o MCP devolve o `sessionId` que a skill reutiliza na conversa. `open` adiciona outra aba ao grupo, `tabs` lista as abas da sessão, `select` troca a seleção e `close` fecha a aba indicada. `navigate` muda de endereço na aba selecionada, inclusive entre domínios. As abas abertas por links da sessão também podem entrar no grupo. O grupo fica aberto para consulta quando a conversa termina.

O agente lê texto e controles HTML do documento principal, clica por referência e preenche formulários. A extensão confere o ID da aba e o grupo antes de executar cada comando. Tirar uma aba do grupo remove o controle sobre ela. Abas pessoais adicionadas manualmente ao grupo continuam fora da lista do agente. A associação das abas sobrevive à suspensão do worker e à reconexão da ponte durante a execução do navegador. Ao reiniciar o navegador ou recarregar a extensão, a próxima tarefa pode abrir um novo grupo.

Nas abas controladas, um ponteiro virtual mostra o alvo do agente antes de cada clique ou preenchimento. A ponta da seta marca o local da interação. Ela desliza até o próximo controle e permanece visível na última posição da aba, inclusive após recarregar ou seguir um link na mesma aba. Com a preferência de movimento reduzido, o ponteiro aparece diretamente no alvo.

O contrato entre as partes fica em `src/shared`, o servidor MCP em `src/agent`, a sessão autenticada em `src/bridge` e o código que age na aba em `src/extension`.

## Testes

O teste de integração usa o cliente MCP oficial, uma ponte local e instalações descartáveis da extensão no Chromium. No Linux, instale Xvfb, disponibilize o Chromium de teste com `npx playwright-core install chromium` e execute:

```sh
xvfb-run -a npm test
```
