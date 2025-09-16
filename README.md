````markdown
# ODA WhatsApp Integration

Este projeto integra o Oracle Digital Assistant (ODA) com o WhatsApp, permitindo a comunicação com usuários através de um chatbot no WhatsApp. A integração utiliza a API do WhatsApp e um servidor Node.js para gerenciar as mensagens e as interações com o ODA.

## Funcionalidades

- Envio e recebimento de mensagens via WhatsApp.
- Integração com o Oracle Digital Assistant (ODA).
- Suporte a interações como botões e listas interativas no WhatsApp.
- Configuração fácil de variáveis de ambiente e integração com o ODA.

## Arquitetura

- **Servidor Node.js**: O servidor é responsável por lidar com as requisições de mensagens, comunicar-se com a API do WhatsApp e o Oracle Digital Assistant.
- **WhatsApp API**: A comunicação com o WhatsApp é feita através da API do WhatsApp.
- **Oracle Digital Assistant**: O ODA é utilizado para gerenciar as interações e lógica de conversa.

## Como Funciona

1. O servidor Node.js recebe a mensagem do WhatsApp.
2. A mensagem é enviada para o Oracle Digital Assistant (ODA) para processamento.
3. O ODA responde com uma mensagem, que é enviada de volta ao usuário via WhatsApp.
4. O servidor também pode responder com botões interativos ou listas, e capturar ações do usuário.

## Pré-requisitos

Antes de rodar o projeto, certifique-se de ter o seguinte:

- **Node.js** (versão 14.x ou superior)
- **NPM** (ou Yarn)
- **Conta no WhatsApp Business API** e credenciais da API
- **Oracle Cloud Account** com ODA configurado
- **Variáveis de ambiente configuradas** (detalhado abaixo)

## Instalação

Siga os passos abaixo para instalar e rodar o projeto localmente.

### Passo 1: Clone o repositório

Abra o terminal e execute o comando abaixo para clonar o repositório do projeto:

```bash
git clone https://github.com/Jumendess/webhook_whatsApp_code.git
```
````

### Passo 2: Acesse o diretório do projeto

```bash
cd webhook_whatsApp_code
```

### Passo 3: Instale as dependências

Se você estiver usando o **NPM**, execute o seguinte comando para instalar as dependências:

```bash
npm install
```

Ou, se preferir usar o **Yarn**, execute:

```bash
yarn install
```

### Passo 4: Configuração das Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
ODA_BOT_URL=<URL_DO_SEU_BOT_ODA>
ODA_SECRET_KEY=<SUA_SECRET_KEY_DO_ODA>
WHATSAPP_API_URL=<URL_DA_API_WHATSAPP>
WHATSAPP_API_KEY=<SUA_CHAVE_API_WHATSAPP>
```

- **ODA_BOT_URL**: URL do seu Oracle Digital Assistant.
- **ODA_SECRET_KEY**: Chave secreta para autenticação no ODA.
- **WHATSAPP_API_URL**: URL da API do WhatsApp Business.
- **WHATSAPP_API_KEY**: Chave de acesso à API do WhatsApp.

### Passo 5: Rodando o Projeto

Agora você está pronto para rodar o projeto!

#### Para rodar o servidor em **desenvolvimento** (com monitoramento automático de alterações):

```bash
npm run start:dev
```

Ou, se preferir usar o **Yarn**:

```bash
yarn start:dev
```

#### Para rodar o servidor em **produção** (sem monitoramento):

```bash
npm start
```

Ou, com **Yarn**:

```bash
yarn start
```

O servidor vai iniciar e escutar na porta configurada no arquivo `.env`. Se você não configurar uma porta específica, o padrão será a porta `3000`.

## Endpoints

### `/message`

Este endpoint é responsável por receber as mensagens do WhatsApp e encaminhá-las para o ODA. O ODA processa a mensagem e retorna uma resposta para ser enviada ao usuário via WhatsApp.

#### Requisição

```http
POST /message
Content-Type: application/json

{
  "userId": "whatsapp_number",
  "message": "mensagem_recebida"
}
```

#### Resposta

```json
{
  "response": "Resposta do ODA"
}
```

### Como Funciona o Fluxo de Mensagens

1. **Recepção da Mensagem**: Quando o usuário envia uma mensagem no WhatsApp, ela é recebida pelo endpoint `/message`.
2. **Envio ao ODA**: A mensagem é enviada ao Oracle Digital Assistant (ODA) para processamento.
3. **Resposta do ODA**: O ODA gera uma resposta com base na configuração do bot e envia de volta para o servidor.
4. **Envio de Mensagem no WhatsApp**: A resposta gerada pelo ODA é enviada para o usuário via WhatsApp.

## Interações Suportadas

### Botões

O projeto suporta botões interativos que permitem ao usuário escolher uma opção diretamente no WhatsApp. Exemplo de código para um botão:

```json
{
  "type": "button",
  "text": "Clique aqui",
  "action": "opcao_1"
}
```

### Listas

As listas são enviadas no formato de uma lista interativa, onde o usuário pode escolher uma opção. A estrutura seria algo como:

```json
{
  "type": "list",
  "text": "Escolha uma opção",
  "options": [
    {
      "id": "opcao_1",
      "label": "Opção 1"
    },
    {
      "id": "opcao_2",
      "label": "Opção 2"
    }
  ]
}
```

## Contribuições

Se você deseja contribuir com o projeto, siga os seguintes passos:

1. Faça um fork deste repositório.
2. Crie uma nova branch (`git checkout -b minha-branch`).
3. Faça suas alterações.
4. Commit suas alterações (`git commit -am 'Adicionando nova funcionalidade'`).
5. Envie para o repositório remoto (`git push origin minha-branch`).
6. Crie um pull request.

## Licença

Este projeto está licenciado sob a Licença MIT - veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---

### Autor

Julio Mendes

GitHub: [https://github.com/Jumendess/webhook_whatsApp_code](https://github.com/Jumendess/webhook_whatsApp_code)

```

### O que foi adicionado e modificado:

- **Comandos para instalação e execução**: Todos os comandos necessários (clone, instalação, rodar o servidor) estão destacados com exemplos prontos para copiar.
- **Passo a Passo**: Cada passo é numerado e fácil de seguir, com exemplos de comandos para copiar diretamente no terminal.
- **Variáveis de Ambiente**: Explicação clara de como configurar as variáveis de ambiente com exemplos de valores.
- **Rodando o Projeto**: Comandos para rodar o servidor em **desenvolvimento** e **produção**, com instruções claras para ambos os casos.


```
