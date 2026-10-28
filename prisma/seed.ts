import type { rolesModel } from '@/server/generated/prisma/models/roles';

import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@/server/generated/prisma/client';
import {
  getPublicUrl,
  objectExistsInS3,
  uploadToS3,
} from '@/server/storage/s3';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const SECTORS = [
  { id: 'farmacia', name: 'Farmácia' },
  { id: 'recepcao', name: 'Recepção Saúde' },
];

// A chave é fixa para o seed ser idempotente (não gera uma notícia nova a cada
// execução).
const DEFAULT_NEWS = {
  title: 'Bem-vindo ao Sistema de Senhas',
  contentType: 'image/jpeg',
  filePath: fileURLToPath(
    new URL('./assets/default-news.jpeg', import.meta.url),
  ),
  imageKey: 'default-news.jpeg',
  // URL gravada pelo seed antigo, que servia a imagem de `public/news`.
  legacyImageUrl: '/news/1789083615350-os7rdzpymeb.jpeg',
};

const USERS = [
  {
    email: 'admin.sistema@central-atendimento.local',
    full_name: 'Administrador do Sistema',
    password: 'admin123',
    role: 'admin',
    sector_id: null,
    username: 'admin',
  },
  {
    email: 'atendente.recepcao@central-atendimento.local',
    full_name: 'Atendente Recepção',
    password: 'recepcao123',
    role: 'attendant',
    sector_id: 'recepcao',
    username: 'atendente.recepcao',
  },
  {
    email: 'atendente.farmacia@central-atendimento.local',
    full_name: 'Atendente Farmácia',
    password: 'farmacia123',
    role: 'attendant',
    sector_id: 'farmacia',
    username: 'atendente.farmacia',
  },
];

/**
 * Garante a imagem padrão no bucket e devolve a URL pública a ser gravada.
 */
async function ensureDefaultNewsImage(): Promise<string> {
  try {
    const imageUrl = getPublicUrl(DEFAULT_NEWS.imageKey);

    if (await objectExistsInS3(DEFAULT_NEWS.imageKey)) {
      console.log('  ✓ Imagem padrão já existe no S3');
      return imageUrl;
    }

    const buffer = await readFile(DEFAULT_NEWS.filePath);
    await uploadToS3(DEFAULT_NEWS.imageKey, buffer, DEFAULT_NEWS.contentType);
    console.log('  ✓ Imagem padrão enviada ao S3');

    return imageUrl;
  } catch (_) {
    console.warn(
      '  ⚠️ Não foi possível integrar a imagem com o S3 (verifique bucket/permissões). Usando URL de fallback.',
    );
    return DEFAULT_NEWS.legacyImageUrl;
  }
}

async function main() {
  // ── Limpa usuários de teste e legados ────────────────────────
  const keepUsernames = USERS.map((u) => u.username);
  const deleted = await prisma.users.deleteMany({
    where: { NOT: { username: { in: keepUsernames } } },
  });
  if (deleted.count > 0) {
    console.log(`  ✓ ${deleted.count} usuários antigos removidos`);
  }

  // ── Cargos built-in (criados pela migration; garantidos aqui
  //    também para bancos criados apenas com o seed) ────────────
  const roles: Record<string, rolesModel> = {};
  for (const [key, name] of [
    ['admin', 'Administrador'],
    ['attendant', 'Atendente'],
  ]) {
    roles[key] = await prisma.roles.upsert({
      create: { name, built_in: true, key },
      update: {},
      where: { key },
    });
  }
  console.log(`  ✓ ${Object.keys(roles).length} cargos criados/verificados`);

  // ── Setores ──────────────────────────────────────────────────
  for (const sector of SECTORS) {
    await prisma.sectors.upsert({
      create: sector,
      update: {},
      where: { id: sector.id },
    });
  }
  console.log(`  ✓ ${SECTORS.length} setores criados/verificados`);

  // ── Notícias ────────────────────────────────────────────────
  const imageUrl = await ensureDefaultNewsImage();
  const existingNews = await prisma.news.findFirst({
    where: {
      image_url: { in: [imageUrl, DEFAULT_NEWS.legacyImageUrl] },
    },
  });

  if (!existingNews) {
    await prisma.news.create({
      data: { title: DEFAULT_NEWS.title, image_url: imageUrl },
    });
    console.log(`  ✓ Notícia padrão criada (${imageUrl})`);
  } else if (existingNews.image_url !== imageUrl) {
    await prisma.news.update({
      data: { image_url: imageUrl },
      where: { id: existingNews.id },
    });
    console.log(`  ✓ Notícia padrão migrada para o S3 (${imageUrl})`);
  } else {
    console.log(`  ✓ Notícia padrão já existe`);
  }

  // ── Usuários ─────────────────────────────────────────────────
  for (const user of USERS) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    await prisma.users.upsert({
      create: {
        id: crypto.randomUUID(),
        email: user.email,
        full_name: user.full_name,
        password_hash: passwordHash,
        role_id: roles[user.role].id,
        sector_id: user.sector_id,
        username: user.username,
      },
      update: {},
      where: { username: user.username },
    });
    console.log(`  ✓ ${user.username} / ${user.password} (${user.role})`);
  }

  console.log('\nSeed concluído.');
}

main()
  .catch((error) => {
    console.error('Erro no seed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
