🧠 Visão Geral do Projeto

Este projeto implementa um conector inteligente entre o Oracle Digital Assistant (ODA) e a WhatsApp Cloud API (Meta), permitindo a comunicação bidirecional entre assistentes virtuais da Oracle e usuários finais no WhatsApp.

A solução foi desenvolvida em Node.js, com Express como servidor HTTP e integração completa com a API Graph do WhatsApp, suportando o envio e recebimento de mensagens, botões interativos, listas, mídias e documentos.
Além disso, conta com suporte nativo a armazenamento de anexos no AWS S3, gerando URLs temporárias assinadas para que o ODA consiga acessar arquivos de forma segura.

⚙️ Objetivo

O principal objetivo é permitir que qualquer assistente criado no Oracle Digital Assistant possa conversar com usuários do WhatsApp em tempo real, com a mesma experiência oferecida nos canais nativos da Oracle.
Isso inclui:

Envio e recebimento de mensagens de texto e mídia.

Renderização de botões e menus interativos.

Sincronização de contexto e estado entre as plataformas.

Armazenamento de arquivos em nuvem com controle de expiração.

Em resumo, trata-se de um middleware universal entre o ODA e o WhatsApp, cuidando de toda a tradução de formatos e autenticação entre os dois sistemas.

🔄 Como Funciona

O conector funciona em duas direções principais:

Direção	Função	Endpoint	Descrição
WhatsApp → ODA	Recepção de mensagens	POST /user/message	Recebe mensagens da Meta e converte para o formato do ODA
ODA → WhatsApp	Envio de mensagens	POST /bot/message	Recebe mensagens do ODA e as transforma no formato aceito pela API do WhatsApp
Verificação	Validação do webhook Meta	GET /user/message	Endpoint usado pelo painel do WhatsApp Cloud API para validar o webhook
Status	Healthcheck	GET /	Retorna um status simples confirmando que o servidor está online

Toda a comunicação é feita de forma assíncrona e confiável, utilizando filas internas para garantir que nenhuma mensagem seja perdida, mesmo em casos de latência na API do WhatsApp ou no ODA.

💬 Recursos Implementados
Entrada (WhatsApp → ODA)

Texto simples

Mensagens interativas (botões e listas)

Localização

Mídias: imagens, vídeos, áudios e documentos

Lógica de deduplicação para evitar mensagens repetidas

Saída (ODA → WhatsApp)

Mensagens de texto e menus interativos

Envio de mídias com upload via media_id ou link público

Gerenciamento de menus:

Evita múltiplos cliques no mesmo botão

Reenvia automaticamente o último menu ativo

Mensagens dinâmicas com cabeçalhos e rodapés

Armazenamento em Nuvem (opcional)

Upload de arquivos no AWS S3

Geração de URL assinada com tempo de expiração configurável

Download e upload automático de mídias recebidas via Graph API

🧩 Arquitetura

A aplicação é composta por três camadas principais:

Servidor (server.js)

Responsável pelos endpoints de entrada e saída.

Integra Express, OracleBot SDK e o cliente WhatsApp.

Conector WhatsApp (whatsApp.js)

Interpreta mensagens do WhatsApp e converte para o formato do ODA.

Gerencia menus interativos e controle de estado.

Sender (whatsAppSender.js)

Lida com envio de mensagens e uploads de mídia.

Utiliza fila interna e SDK da AWS para armazenar arquivos.

🧠 Benefícios Técnicos

Código modular e de fácil manutenção.

Suporte completo à API do WhatsApp Cloud (Meta Graph).

Compatível com múltiplos canais do ODA.

Gerenciamento de anexos seguro via S3 (ou opcionalmente local).

Logs estruturados e configuráveis com log4js.

Facilidade para escalar ou dockerizar em ambientes de produção.

🚀 Casos de Uso

Chatbots corporativos no WhatsApp utilizando o ODA como cérebro conversacional.

Atendimento automatizado para vendas, suporte e triagem.

Integrações empresariais com ERPs, CRMs e APIs internas via ODA.

Automação de envio de documentos e coleta de arquivos via WhatsApp.