# PulseBrowser

Navegador para Windows baseado no **Chromium 152** (via Electron 44), com interface própria em português.

![logo](src/assets/icon.png)

## Download

Baixe o instalador **PulseBrowser-Setup-1.1.0.exe** na página de [Releases](../../releases/latest) (Windows 10/11, 64 bits).

O instalador não tem assinatura digital, então o Windows pode mostrar "O Windows protegeu o computador". Clique em **Mais informações** e depois em **Executar assim mesmo**.

## Novidades da versão 1.1

- **Gerenciador de senhas**: oferece para salvar a senha quando você entra em um site e sugere as contas salvas ao clicar no campo de login. As senhas ficam criptografadas com a sua conta do Windows. A página `pulse://passwords` permite buscar, ver, copiar, editar, excluir e adicionar senhas. Ela também importa e exporta arquivos CSV (Chrome, Edge, Firefox, Opera e Bitwarden), mantém a lista de sites em que você escolheu "nunca salvar" e sugere senhas fortes.
- **Verificação de senhas**: encontra senhas fracas, repetidas em vários sites ou vazadas em ataques. A consulta de vazamentos usa o Have I Been Pwned com k-anonimato: só os 5 primeiros caracteres de um hash da senha saem do computador.
- **Contas do Google**: botão de perfil na barra com sua foto e um menu com Gmail, Drive, Agenda, YouTube, outras contas, "Adicionar conta" e "Sair". Um modo de compatibilidade evita o aviso "este navegador pode não ser seguro" na página de login do Google.
- **Corretor gramatical (no estilo do Grammarly)**: sublinha erros de ortografia (vermelho), gramática (amarelo) e estilo (cor de destaque) nas caixas de texto e editores dos sites. Ao passar o mouse aparece a correção; o botão no canto do campo lista todas as sugestões, tem "Corrigir tudo" e permite escolher o idioma. Funciona com 25 idiomas e detecção automática, dicionário pessoal, sites desativados, modo rigoroso e correção automática opcional. O texto é verificado pelo [LanguageTool](https://languagetool.org); é possível usar um servidor LanguageTool próprio.
- **Animações**: abas que crescem e encolhem, reordenação suave, menus e pop-ups com efeito de mola, barra de progresso de carregamento, notificações animadas e entradas suaves nas páginas internas. Dá para desligar em Configurações › Aparência, e o PulseBrowser respeita a opção de reduzir movimento do Windows.

## Recursos

- **Abas completas**: arrastar para reordenar, fixar, silenciar, duplicar, mover para nova janela, reabrir abas fechadas (Ctrl+Shift+T), fechar outras/à direita e botão do meio para fechar.
- **Barra de endereço inteligente**: sugestões do mecanismo de pesquisa, histórico, favoritos e abas abertas ("Mudar para esta aba"), autocompletar em linha, Alt+Enter (nova aba) e Ctrl+Enter (completa `www.…com`).
- **Pulse Shield**: bloqueador de anúncios, rastreadores, telemetria, golpes e mineradores. Usa as mesmas listas de filtros do uBlock Origin (EasyList, EasyPrivacy, filtros do uBlock, EasyList Portuguese, Peter Lowe e HaGeZi), que são atualizadas sozinhas a cada poucos dias, mais uma lista interna com 11 categorias. Esconde os espaços vazios de anúncio e os avisos de cookies, pula os anúncios do YouTube, limpa parâmetros de rastreamento dos links (`fbclid`, `gclid`, `utm_*`…) e troca scripts de anúncio por versões inofensivas para não quebrar players de vídeo. O pop-up mostra o que foi bloqueado em cada categoria; em Configurações dá para escolher as categorias, as listas e as exceções por site. Faz 99% no [superadblocktest.com](https://superadblocktest.com).
- **Janela anônima**: sessão separada na memória, apagada quando a última janela anônima é fechada.
- **Favoritos**: barra de favoritos com pastas, gerenciador (`pulse://bookmarks`), importação do Google Chrome e de arquivos HTML, exportação.
- **Histórico** (`pulse://history`) com busca, agrupado por dia, seleção múltipla.
- **Downloads** (`pulse://downloads`): pausar, continuar, cancelar, tentar de novo, progresso no ícone e na barra de tarefas do Windows.
- **Configurações** (`pulse://settings`): tema claro/escuro/sistema, cor de destaque, animações, página inicial, mecanismo de pesquisa (Google, Bing, DuckDuckGo, Brave, Ecosia, Yahoo), limpar dados de navegação, senhas e contas, corretor gramatical, permissões de sites, pasta de downloads, economia de memória, corretor ortográfico, extensões (beta) e "Tornar padrão".
- **Permissões por site**: câmera, microfone, localização, notificações e compartilhamento de tela, com prompts no estilo do Chrome.
- **Segurança**: cadeado e aviso "Não seguro", página de certificado inválido com opção "continuar mesmo assim", páginas internas isoladas (sites não conseguem abri-las nem acessar sua API), CSP nas páginas internas e sandbox em todas as abas.
- **Ferramentas**: DevTools do Chromium encaixadas na janela (F12), inspecionar elemento, código-fonte (Ctrl+U), localizar na página (Ctrl+F), zoom por site, imprimir, salvar como PDF, salvar página completa e capturar a tela da página.
- **Mais**: restauração de sessão com o histórico de cada aba, economia de memória (abas inativas entram em espera), visualizador de PDF, tela cheia de vídeos, picture-in-picture, login HTTP, páginas de erro amigáveis com um minijogo quando a internet cai, lista de atalhos na Jump List do Windows.

## Como usar

Requer Node.js 22 ou mais recente.

```bash
npm install
npm start
```

### Gerar o instalador do Windows

```bash
npm run dist
```

O instalador é gerado em `dist/PulseBrowser Setup 1.1.0.exe`.

> **Atenção:** o NSIS (usado para gerar o instalador) não funciona com caminhos de pasta muito longos (limite de 260 caracteres do Windows). Se o build falhar com `!include: could not open file`, copie o projeto para uma pasta curta (por exemplo `C:\pb`) e rode o comando lá.

Para gerar ícones novos a partir do logo: `npm run icon`.

## Atalhos de teclado

| Ação | Atalho |
| --- | --- |
| Nova aba / janela / janela anônima | Ctrl+T / Ctrl+N / Ctrl+Shift+N |
| Fechar aba / reabrir aba fechada | Ctrl+W / Ctrl+Shift+T |
| Próxima / anterior aba | Ctrl+Tab / Ctrl+Shift+Tab |
| Ir para a aba 1–8 / última | Ctrl+1…8 / Ctrl+9 |
| Barra de endereço | Ctrl+L, Alt+D ou F6 |
| Voltar / avançar | Alt+← / Alt+→ |
| Recarregar / sem cache | F5 / Ctrl+F5 |
| Localizar | Ctrl+F (F3 próximo) |
| Zoom | Ctrl++ / Ctrl+- / Ctrl+0 |
| Favoritar / barra de favoritos / gerenciador | Ctrl+D / Ctrl+Shift+B / Ctrl+Shift+O |
| Histórico / downloads | Ctrl+H / Ctrl+J |
| Imprimir / salvar / capturar | Ctrl+P / Ctrl+S / Ctrl+Shift+S |
| DevTools / código-fonte | F12 / Ctrl+U |
| Tela cheia | F11 |
| Limpar dados de navegação | Ctrl+Shift+Delete |
| Navegar pelas sugestões do corretor ou de login | ↑ / ↓, Enter, Esc |

## Estrutura

```
src/
  main/       processo principal (janelas, abas, sessões, Shield, downloads, histórico, favoritos, IPC)
  preload/    pontes seguras (interface e páginas internas) e scripts de senhas e do corretor nos sites
  ui/         barra de abas e ferramentas (index.html) e sobreposição de pop-ups (overlay.html)
  pages/      páginas internas pulse:// (nova aba, histórico, favoritos, downloads, senhas, configurações, sobre, erro)
  shared/     ícones SVG compartilhados
  assets/     ícones do aplicativo
scripts/      geração de ícones
build/        recursos do instalador
```

Os dados do usuário (configurações, histórico, favoritos, sessão e senhas criptografadas) ficam em `%APPDATA%\PulseBrowser`.

### Privacidade do Pulse Shield

- As listas de filtros são baixadas dos repositórios oficiais (ou de um espelho no GitHub mantido pela Ghostery) e ficam em `%APPDATA%\PulseBrowser\shield`. Nenhuma informação sobre os sites que você visita é enviada.
- O motor de filtros é o [@ghostery/adblocker](https://github.com/ghostery/adblocker) (licença MPL-2.0). As listas têm licenças próprias (GPL-3.0, CC BY-SA e outras) e não vêm junto com o instalador.

### Privacidade do corretor e das contas

- O corretor envia o texto dos campos em que você está escrevendo para a API pública do LanguageTool (`api.languagetool.org`), só depois que você clica no campo e digita. Campos de senha, de código e marcados com `spellcheck="false"` nunca são enviados. Para manter o texto no seu computador, rode um [servidor LanguageTool](https://dev.languagetool.org/http-server) e informe o endereço em Configurações › Corretor gramatical, ou desligue o corretor.
- O botão de perfil lê a lista de contas do Google conectadas a partir dos cookies do próprio navegador. Nada é enviado a outros serviços.

## Limitações conhecidas

- **Netflix, Spotify Web e outros serviços com DRM (Widevine)** não funcionam: o Electron não inclui o módulo Widevine.
- **Extensões do Chrome** têm suporte parcial (scripts de conteúdo e páginas de opções); pop-ups de extensões na barra de ferramentas e a Chrome Web Store não funcionam.
- Não há sincronização entre dispositivos nem preenchimento automático de endereços e cartões. As senhas salvas ficam só neste computador; use Exportar/Importar para levá-las a outro.
- O login do Google funciona pelo site (como no Firefox). Recursos que dependem do login do próprio Chrome, como a sincronização do Chrome, não estão disponíveis.
- O corretor gramatical usa a API pública gratuita do LanguageTool, que tem limite de uso: textos muito longos (mais de 15 mil caracteres) são verificados só em parte e, se você escrever muito rápido em vários campos, a verificação pode pausar por um minuto.
- A localização (geolocalização) pode não funcionar, pois o serviço do Google exige uma chave de API.
- O Pulse Shield não bloqueia o player JW Player (`ssl.p.jwpcdn.com`), só os plugins de anúncio dele, porque muitos sites de notícias usam esse player nos vídeos comuns.
- As categorias opcionais (redes sociais, chat de atendimento, avisos de cookies, testes A/B, rastreadores de erros e afiliados) vêm ligadas. Se um site perder o chat, o botão "Curtir" ou um link de oferta, desligue a categoria em Configurações › Pulse Shield ou adicione o site às exceções.
