require('dotenv').config();
const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const NUVEMSHOP_TOKEN = process.env.NUVEMSHOP_TOKEN;
const NUVEMSHOP_STORE_ID = process.env.NUVEMSHOP_STORE_ID;
const KOMMO_TOKEN = process.env.KOMMO_TOKEN;
const KOMMO_DOMAIN = process.env.KOMMO_DOMAIN;

// ─────────────────────────────────────────
// PROMPT BASE DO AGENTE — LION PACKING
// ─────────────────────────────────────────
const SYSTEM_PROMPT = `
Você é um vendedor consultivo da Lion Packing (lionpacking.com.br).

Seu objetivo é:
- Vender
- Gerar conexão humana
- Qualificar leads
- Acelerar orçamentos
- Conduzir o cliente até uma reunião ou fechamento

Tom de comunicação:
- Humano, moderno, rápido e amigável
- Linguagem do cotidiano, simples e direta
- Respeitoso e com postura comercial premium
- Frases curtas — nunca escreva textos longos
- Nunca fale como robô

Regras de interação:
- Chame o cliente pelo nome sempre que souber
- Use "meu querido" em saudações naturalmente
- Use "amigo" de forma casual no decorrer da conversa
- Mantenha a conversa dinâmica e fluida
- Nunca use blocos de texto enormes — seja direto

Você domina toda a linha de produtos Lion Packing:
- Válvulas (linha completa)
- Triggers e Mini Triggers
- Lotion Pumps
- Tampas diversas
- Soluções para segmento Pharma
- Soluções para Cosmética
- Soluções para Limpeza
- Materiais, cores e acabamentos disponíveis
- Aplicações e compatibilidade de produto
- Processo produtivo e personalização
- MOQ (quantidade mínima de pedido)
- Prazos de produção e entrega

Objetivo final de cada conversa:
1. Captar a necessidade real do cliente
2. Qualificar o volume (quantidade pretendida)
3. Entender a aplicação (pharma, cosméticos, limpeza etc.)
4. Direcionar ao vendedor humano quando necessário
5. Gerar orçamento ou agendar reunião comercial

Lembre-se: você vende embalagens de alta performance. O cliente precisa sentir que está falando com um especialista de verdade — não com um bot.
`;

// ─────────────────────────────────────────
// Histórico de conversas por sessão
// ─────────────────────────────────────────
const historico = {};

// ─────────────────────────────────────────
// Busca produtos na Nuvemshop
// ─────────────────────────────────────────
async function buscarProdutos(query) {
  try {
    const res = await axios.get(
      `https://api.tiendanube.com/v1/${NUVEMSHOP_STORE_ID}/products?q=${encodeURIComponent(query)}`,
      {
        headers: {
          Authentication: `bearer ${NUVEMSHOP_TOKEN}`,
          'User-Agent': 'LionPacking Bot'
        }
      }
    );
    return res.data.slice(0, 3).map(p => ({
      nome: p.name?.pt || p.name,
      preco: p.variants?.[0]?.price,
      link: p.canonical_url
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────
// Gera resposta com GPT (com histórico)
// ─────────────────────────────────────────
async function gerarResposta(sessionId, mensagem, produtos) {
  if (!historico[sessionId]) historico[sessionId] = [];

  const contextoProdutos = produtos.length
    ? `\n\nProdutos relevantes encontrados no site: ${JSON.stringify(produtos, null, 2)}`
    : '';

  historico[sessionId].push({ role: 'user', content: mensagem });

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + contextoProdutos },
    ...historico[sessionId]
  ];

  const resposta = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    temperature: 0.8,
    max_tokens: 300,
    presence_penalty: 0.6,
    frequency_penalty: 0.5
  });

  const textoResposta = resposta.choices[0].message.content;
  historico[sessionId].push({ role: 'assistant', content: textoResposta });

  if (historico[sessionId].length > 20) {
    historico[sessionId] = historico[sessionId].slice(-20);
  }

  return textoResposta;
}

// ─────────────────────────────────────────
// Cria ou atualiza lead no Kommo
// ─────────────────────────────────────────
async function criarLeadKommo(nome, mensagem, resposta) {
  try {
    const leadRes = await axios.post(
      `https://${KOMMO_DOMAIN}/api/v4/leads`,
      [{ name: `Lion Packing — ${nome || 'Visitante'}` }],
      { headers: { Authorization: `Bearer ${KOMMO_TOKEN}` } }
    );

    const leadId = leadRes.data?._embedded?.leads?.[0]?.id;

    if (leadId) {
      await axios.post(
        `https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}/notes`,
        [{ note_type: 4, params: { text: `Cliente: ${mensagem}\n\nBot: ${resposta}` } }],
        { headers: { Authorization: `Bearer ${KOMMO_TOKEN}` } }
      );
    }
  } catch (err) {
    console.error('Kommo error:', err.message);
  }
}

// ─────────────────────────────────────────
// WEBHOOK — recebe mensagens
// ─────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const { message, contact_name, session_id } = req.body;

  if (!message) return res.status(400).json({ error: 'Mensagem vazia' });

  const sessionId = session_id || contact_name || 'default';

  try {
    const produtos = await buscarProdutos(message);
    const resposta = await gerarResposta(sessionId, message, produtos);
    await criarLeadKommo(contact_name, message, resposta);

    res.json({ reply: resposta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno no bot' });
  }
});

app.get('/', (req, res) => res.send('Lion Packing Bot — online'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Lion Packing Bot rodando na porta ' + PORT));
