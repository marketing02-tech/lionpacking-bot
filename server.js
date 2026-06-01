require('dotenv').config();
const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const KOMMO_TOKEN = process.env.KOMMO_TOKEN;
const KOMMO_DOMAIN = process.env.KOMMO_DOMAIN;

const SYSTEM_PROMPT = `Você é um vendedor consultivo da Lion Packing (lionpacking.com.br).

Seu objetivo é: vender, gerar conexão humana, qualificar leads, acelerar orçamentos, conduzir o cliente até reunião ou fechamento.

Tom: humano, moderno, rápido, amigável, cotidiano, respeitoso, linguagem simples, frases curtas, comercial premium.

Sempre: chame o cliente pelo nome quando souber, use "meu querido" em saudações, use "amigo" naturalmente, nunca fale como robô, nunca escreva textos longos, mantenha conversa dinâmica.

Você conhece: toda linha de válvulas, triggers, mini triggers, lotion pumps, tampas, soluções pharma, cosméticas, limpeza, materiais, cores, aplicações, produção, MOQ, prazos, personalização.

Objetivo final: captar necessidade, qualificar volume, entender aplicação, direcionar ao vendedor, gerar orçamento.`;

const conversas = {};

async function gerarResposta(leadId, nomeContato, mensagemCliente) {
  if (!conversas[leadId]) {
    conversas[leadId] = [{ role: 'system', content: SYSTEM_PROMPT }];
  }
  conversas[leadId].push({ role: 'user', content: mensagemCliente });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: conversas[leadId],
    temperature: 0.8,
    max_tokens: 300
  });

  const resposta = completion.choices[0].message.content;
  conversas[leadId].push({ role: 'assistant', content: resposta });
  return resposta;
}

async function enviarMensagemKommo(leadId, texto) {
  const url = `https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}/notes`;
  await axios.post(url, {
    note_type: 4,
    params: { text: texto }
  }, {
    headers: {
      Authorization: `Bearer ${KOMMO_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

async function enviarMensagemChat(talkId, texto) {
  const url = `https://${KOMMO_DOMAIN}/api/v4/talks/${talkId}/reply`;
  await axios.post(url, { text: texto }, {
    headers: {
      Authorization: `Bearer ${KOMMO_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

// Health check
app.get('/', (req, res) => res.json({ status: 'Lion Packing Bot online' }));
app.get('/webhook', (req, res) => res.json({ status: 'ok' }));

// Webhook principal
app.post('/webhook', async (req, res) => {
  console.log('Webhook recebido:', JSON.stringify(req.body).substring(0, 500));
  res.status(200).json({ ok: true });

  try {
    const body = req.body;

    // Mensagem de chat recebida (incoming_chat_message)
    if (body.message && body.message.add) {
      for (const msg of body.message.add) {
        if (msg.type === 'incoming' || (msg.author && msg.author.type === 'contact')) {
          const leadId = msg.entity && msg.entity.id;
          const talkId = msg.talk_id;
          const texto = msg.text || (msg.content && msg.content.text) || '';
          const nomeContato = (msg.author && msg.author.name) || 'cliente';

          if (!texto) continue;

          console.log(`Mensagem de ${nomeContato} no lead ${leadId}: ${texto}`);
          const resposta = await gerarResposta(leadId || talkId, nomeContato, texto);
          console.log(`Resposta GPT: ${resposta}`);

          if (talkId) {
            try {
              await enviarMensagemChat(talkId, resposta);
            } catch (e) {
              console.log('Erro chat reply, tentando nota:', e.message);
              if (leadId) await enviarMensagemKommo(leadId, resposta);
            }
          } else if (leadId) {
            await enviarMensagemKommo(leadId, resposta);
          }
        }
      }
    }

    // Novo lead adicionado
    if (body.leads && body.leads.add) {
      for (const lead of body.leads.add) {
        const leadId = lead.id;
        const nomeLead = lead.name || 'Novo lead';
        console.log(`Novo lead: ${leadId} - ${nomeLead}`);

        const resposta = await gerarResposta(leadId, nomeLead, `Olá, tenho interesse nos produtos da Lion Packing`);
        await enviarMensagemKommo(leadId, resposta);
      }
    }

    // Mensagem recebida via unsorted (inbox)
    if (body.unsorted && body.unsorted.add) {
      for (const item of body.unsorted.add) {
        console.log('Unsorted recebido:', JSON.stringify(item).substring(0, 200));
      }
    }

  } catch (err) {
    console.error('Erro processando webhook:', err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lion Packing Bot rodando na porta ${PORT}`));
