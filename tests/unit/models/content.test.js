import content from '../../models/content.js'; // Importe o objeto content
import prestige from '../../models/prestige.js'; // Importe prestige
import balance from '../../models/balance.js'; // Importe balance
import database from '../../infra/database.js'; // Importe database, se necessário for mockar

import { jest } from '@jest/globals'; // Para Jest mocks

describe('content.creditOrDebitTabCoins', () => {
  let mockTransaction;

  beforeEach(() => {
    jest.clearAllMocks(); // Limpa mocks antes de cada teste

    // Mock para uma transação simples
    mockTransaction = {
      commit: jest.fn(),
      rollback: jest.fn(),
    };

    // Mock das dependências que o método creditOrDebitTabCoins utiliza
    prestige.getByContentId = jest.fn();
    prestige.getByUserId = jest.fn();
    balance.create = jest.fn();
    database.query = jest.fn(); // Se creditOrDebitTabCoins chamar database.query diretamente

    // Configurações padrão para os mocks para que os testes que não os utilizam diretamente não falhem
    prestige.getByContentId.mockResolvedValue({ user_id: 'mock_user_id', totalTabcoins: 0, initialTabcoins: 0 });
    prestige.getByUserId.mockResolvedValue(0);
    balance.create.mockResolvedValue(true);
    database.query.mockResolvedValue({ rows: [] });
  });

  // CT1: Conteúdo Publicado -> Não Publicado (Tabcoins Positivas)
  test('CT1: Should debit user when content was published and is now deleted with positive tabcoins', async () => {
    const oldContent = {
      id: 'content-id-1',
      owner_id: 'user-id-1',
      published_at: new Date('2023-01-01T10:00:00Z'),
      tabcoins: 10,
    };
    const newContent = {
      id: 'content-id-1',
      owner_id: 'user-id-1',
      status: 'deleted',
      tabcoins: 10,
    };
    const options = { transaction: mockTransaction };

    prestige.getByContentId.mockResolvedValueOnce({
      user_id: oldContent.owner_id,
      totalTabcoins: 10, // Simula os ganhos totais pelo conteúdo
      initialTabcoins: 1,
    });

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByContentId).toHaveBeenCalledWith(oldContent.id, { transaction: mockTransaction });
    expect(balance.create).toHaveBeenCalledWith(
      {
        balanceType: 'user:tabcoin',
        recipientId: newContent.owner_id,
        amount: -10, // Deve debitar o total de tabcoins (totalTabcoins)
        originatorType: 'content',
        originatorId: newContent.id,
      },
      { transaction: mockTransaction },
    );
  });

  // CT2: Conteúdo Publicado -> Publicado (Status Mantido)
  test('CT2: Should not debit/credit if content remains published', async () => {
    const oldContent = {
      id: 'content-id-2',
      owner_id: 'user-id-2',
      published_at: new Date('2023-01-01T10:00:00Z'),
      status: 'published',
    };
    const newContent = {
      id: 'content-id-2',
      owner_id: 'user-id-2',
      status: 'published', // Continua publicado
    };
    const options = { transaction: mockTransaction };

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByContentId).not.toHaveBeenCalled();
    expect(balance.create).not.toHaveBeenCalled();
    expect(prestige.getByUserId).not.toHaveBeenCalled();
  });

  // CT3: Conteúdo NUNCA Publicado -> Não Publicado
  test('CT3: Should not debit/credit if content was never published and is now non-published', async () => {
    const oldContent = {
      id: 'content-id-3',
      owner_id: 'user-id-3',
      published_at: null, // Nunca publicado
      status: 'draft',
    };
    const newContent = {
      id: 'content-id-3',
      owner_id: 'user-id-3',
      status: 'deleted',
    };
    const options = { transaction: mockTransaction };

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByContentId).not.toHaveBeenCalled();
    expect(balance.create).not.toHaveBeenCalled();
    expect(prestige.getByUserId).not.toHaveBeenCalled();
  });

  // CT4: Conteúdo Publicado -> Não Publicado (Tabcoins Negativas)
  test('CT4: Should debit initialTabcoins when content was published and is now archived with negative tabcoins', async () => {
    const oldContent = {
      id: 'content-id-4',
      owner_id: 'user-id-4',
      published_at: new Date('2023-01-01T10:00:00Z'),
      tabcoins: -5,
    };
    const newContent = {
      id: 'content-id-4',
      owner_id: 'user-id-4',
      status: 'archived',
      tabcoins: -5,
    };
    const options = { transaction: mockTransaction };

    prestige.getByContentId.mockResolvedValueOnce({
      user_id: oldContent.owner_id,
      totalTabcoins: 10,
      initialTabcoins: -1, // Valor a ser debitado neste cenário (initialTabcoins)
    });

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByContentId).toHaveBeenCalledWith(oldContent.id, { transaction: mockTransaction });
    expect(balance.create).toHaveBeenCalledWith(
      {
        balanceType: 'user:tabcoin',
        recipientId: newContent.owner_id,
        amount: -(-1), // amountToDebit será -(initialTabcoins)
        originatorType: 'content',
        originatorId: newContent.id,
      },
      { transaction: mockTransaction },
    );
  });

  // CT5: Conteúdo Publicado -> Não Publicado (Tabcoins Zero)
  test('CT5: Should debit zero when content was published and is now spam with zero tabcoins', async () => {
    const oldContent = {
      id: 'content-id-5',
      owner_id: 'user-id-5',
      published_at: new Date('2023-01-01T10:00:00Z'),
      tabcoins: 0,
    };
    const newContent = {
      id: 'content-id-5',
      owner_id: 'user-id-5',
      status: 'spam',
      tabcoins: 0,
    };
    const options = { transaction: mockTransaction };

    prestige.getByContentId.mockResolvedValueOnce({
      user_id: oldContent.owner_id,
      totalTabcoins: 0, // Total de tabcoins zero
      initialTabcoins: 0, // Initial tabcoins zero
    });

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByContentId).toHaveBeenCalledWith(oldContent.id, { transaction: mockTransaction });
    // amountToDebit será -0 ou -0, então amountToDebit será 0.
    // O if (!amountToDebit) return; fará com que balance.create não seja chamado.
    expect(balance.create).not.toHaveBeenCalled();
  });

  // Novo CT para cobrir o primeiro bloco IF que retorna, usando a condição ||
  // Ex: oldContent exists, !oldContent.published_at && newContent.status !== 'published' (TRUE)
  test('CT6: Should not debit/credit if oldContent was never published and new status is not published', async () => {
    const oldContent = {
      id: 'content-id-6',
      owner_id: 'user-id-6',
      published_at: null, // Nunca publicado
      status: 'draft',
    };
    const newContent = {
      id: 'content-id-6',
      owner_id: 'user-id-6',
      status: 'pending', // Não publicado
    };
    const options = { transaction: mockTransaction };

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByContentId).not.toHaveBeenCalled();
    expect(balance.create).not.toHaveBeenCalled();
    expect(prestige.getByUserId).not.toHaveBeenCalled();
  });

  // Novo CT para cobrir o primeiro bloco IF que retorna, usando a condição ||
  // Ex: oldContent exists, oldContent.status === 'deleted' (TRUE)
  test('CT7: Should not debit/credit if oldContent status was deleted', async () => {
    const oldContent = {
      id: 'content-id-7',
      owner_id: 'user-id-7',
      published_at: new Date('2023-01-01T10:00:00Z'),
      status: 'deleted', // Status era 'deleted'
    };
    const newContent = {
      id: 'content-id-7',
      owner_id: 'user-id-7',
      status: 'published', // Tentando mudar para publicado (mas a regra inicial impede)
    };
    const options = { transaction: mockTransaction };

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByContentId).not.toHaveBeenCalled();
    expect(balance.create).not.toHaveBeenCalled();
    expect(prestige.getByUserId).not.toHaveBeenCalled();
  });

  // CT para o bloco IF de crédito - Criação de conteúdo diretamente publicado
  test('CT8: Should credit if new content is created directly with published status', async () => {
    const oldContent = null; // Conteúdo novo
    const newContent = {
      id: 'content-id-8',
      owner_id: 'user-id-8',
      published_at: new Date('2023-01-01T10:00:00Z'), // Publicado na criação
      status: 'published',
      type: 'content',
      parent_id: null,
      body: 'This is a test body with enough words to pass the check. abcde abcde abcde abcde abcde', // >= 5 words >= 5 chars
    };
    const options = { transaction: mockTransaction };

    prestige.getByUserId.mockResolvedValueOnce(5); // Simula ganhos positivos para o usuário

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByUserId).toHaveBeenCalledWith(newContent.owner_id, {
      isRoot: true,
      transaction: mockTransaction,
    });
    expect(balance.create).toHaveBeenCalledWith(
      {
        balanceType: 'user:tabcoin',
        recipientId: newContent.owner_id,
        amount: 5, // Crédito para o usuário
        originatorType: 'content',
        originatorId: newContent.id,
      },
      { transaction: mockTransaction },
    );
    expect(balance.create).toHaveBeenCalledWith(
      {
        balanceType: 'content:tabcoin:initial',
        recipientId: newContent.id,
        amount: 1, // Crédito inicial para o conteúdo
        originatorType: 'user',
        originatorId: newContent.owner_id,
      },
      { transaction: mockTransaction },
    );
  });

  // CT para o bloco IF de crédito - Publicação pela primeira vez
  test('CT9: Should credit if existing content is published for the first time', async () => {
    const oldContent = {
      id: 'content-id-9',
      owner_id: 'user-id-9',
      published_at: null, // Não era publicado
      status: 'draft',
    };
    const newContent = {
      id: 'content-id-9',
      owner_id: 'user-id-9',
      published_at: new Date('2023-01-01T10:00:00Z'), // Agora publicado
      status: 'published',
      type: 'content',
      parent_id: null,
      body: 'This is another test body with enough words to pass the check. abcde abcde abcde abcde abcde',
    };
    const options = { transaction: mockTransaction };

    prestige.getByUserId.mockResolvedValueOnce(5); // Simula ganhos positivos para o usuário

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByUserId).toHaveBeenCalledWith(newContent.owner_id, {
      isRoot: true,
      transaction: mockTransaction,
    });
    expect(balance.create).toHaveBeenCalledWith(
      {
        balanceType: 'user:tabcoin',
        recipientId: newContent.owner_id,
        amount: 5,
        originatorType: 'content',
        originatorId: newContent.id,
      },
      { transaction: mockTransaction },
    );
    expect(balance.create).toHaveBeenCalledWith(
      {
        balanceType: 'content:tabcoin:initial',
        recipientId: newContent.id,
        amount: 1,
        originatorType: 'user',
        originatorId: newContent.owner_id,
      },
      { transaction: mockTransaction },
    );
  });

  // CT para o bloco IF de crédito - userEarnings < 0 (ForbiddenError)
  test('CT10: Should throw ForbiddenError if userEarnings is negative upon publishing', async () => {
    const oldContent = null;
    const newContent = {
      id: 'content-id-10',
      owner_id: 'user-id-10',
      published_at: new Date('2023-01-01T10:00:00Z'),
      status: 'published',
      type: 'content',
      parent_id: null,
      body: 'This is a test body with enough words to pass the check. abcde abcde abcde abcde abcde',
    };
    const options = { transaction: mockTransaction };

    prestige.getByUserId.mockResolvedValueOnce(-5); // Simula ganhos negativos para o usuário

    await expect(content.creditOrDebitTabCoins(oldContent, newContent, options)).rejects.toThrow(
      'Não é possível publicar porque há outras publicações mal avaliadas que ainda não foram excluídas.',
    );
    expect(prestige.getByUserId).toHaveBeenCalled();
    expect(balance.create).not.toHaveBeenCalled();
  });

  // CT para o bloco IF de crédito - newContent.type !== 'content'
  test('CT11: Should not credit user if newContent type is not "content"', async () => {
    const oldContent = null;
    const newContent = {
      id: 'content-id-11',
      owner_id: 'user-id-11',
      published_at: new Date('2023-01-01T10:00:00Z'),
      status: 'published',
      type: 'comment', // Tipo diferente de 'content'
      parent_id: 'parent-id',
      body: 'This is a test body with enough words to pass the check. abcde abcde abcde abcde abcde',
    };
    const options = { transaction: mockTransaction };

    prestige.getByUserId.mockResolvedValueOnce(5); // Ganhos iniciais positivos

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByUserId).toHaveBeenCalled();
    // userEarnings deve ser resetado para 0, então balance.create para user não é chamado
    expect(balance.create).not.toHaveBeenCalledWith(expect.objectContaining({ balanceType: 'user:tabcoin' }), expect.any(Object));
    // balance.create para content initial ainda deve ser chamado (contentEarnings = 1)
    expect(balance.create).toHaveBeenCalledWith(
      {
        balanceType: 'content:tabcoin:initial',
        recipientId: newContent.id,
        amount: 1,
        originatorType: 'user',
        originatorId: newContent.owner_id,
      },
      { transaction: mockTransaction },
    );
  });

  // CT para o bloco IF de crédito - newContent.body muito curto
  test('CT12: Should not credit if content body is too short', async () => {
    const oldContent = null;
    const newContent = {
      id: 'content-id-12',
      owner_id: 'user-id-12',
      published_at: new Date('2023-01-01T10:00:00Z'),
      status: 'published',
      type: 'content',
      parent_id: null,
      body: 'short', // Corpo muito curto
    };
    const options = { transaction: mockTransaction };

    prestige.getByUserId.mockResolvedValueOnce(5);

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByUserId).toHaveBeenCalled();
    expect(balance.create).not.toHaveBeenCalled(); // Nenhuma operação de crédito deve ocorrer
  });

  // CT para o bloco IF de crédito - parentOwnerId === newContent.owner_id
  test('CT13: Should not credit if parent content is from the same user', async () => {
    const oldContent = null;
    const newContent = {
      id: 'content-id-13',
      owner_id: 'user-id-13',
      published_at: new Date('2023-01-01T10:00:00Z'),
      status: 'published',
      type: 'content',
      parent_id: 'parent-id-13',
      parent_owner_id: 'user-id-13', // Mesmo owner do pai
      body: 'This is a test body with enough words to pass the check. abcde abcde abcde abcde abcde',
    };
    const options = { transaction: mockTransaction };

    prestige.getByUserId.mockResolvedValueOnce(5);

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(prestige.getByUserId).toHaveBeenCalled();
    expect(balance.create).not.toHaveBeenCalled(); // Nenhuma operação de crédito deve ocorrer
  });

  // CT para o bloco IF de crédito - parentOwnerId undefined, precisa de lookup no DB
  test('CT14: Should credit if parent content is from different user and parentOwnerId needs lookup', async () => {
    const oldContent = null;
    const newContent = {
      id: 'content-id-14',
      owner_id: 'user-id-14',
      published_at: new Date('2023-01-01T10:00:00Z'),
      status: 'published',
      type: 'content',
      parent_id: 'parent-id-14',
      // parent_owner_id é undefined, forçando o lookup no DB
      body: 'This is a test body with enough words to pass the check. abcde abcde abcde abcde abcde',
    };
    const options = { transaction: mockTransaction };

    prestige.getByUserId.mockResolvedValueOnce(5);
    database.query.mockResolvedValueOnce({ rows: [{ owner_id: 'different-user-id' }] }); // Mock do lookup do pai

    await content.creditOrDebitTabCoins(oldContent, newContent, options);

    expect(database.query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: `SELECT owner_id FROM contents WHERE id = $1;`,
        values: [newContent.parent_id],
      }),
      options,
    );
    expect(prestige.getByUserId).toHaveBeenCalled();
    expect(balance.create).toHaveBeenCalledWith(
      expect.objectContaining({ balanceType: 'user:tabcoin', amount: 5 }),
      expect.any(Object),
    );
    expect(balance.create).toHaveBeenCalledWith(
      expect.objectContaining({ balanceType: 'content:tabcoin:initial', amount: 1 }),
      expect.any(Object),
    );
  });
});
