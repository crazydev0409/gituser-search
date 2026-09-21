import { discoverContacts, extractContacts, safeContactUrl } from './contacts';
import { mergeStoredUsers, loadStoredUsers, saveStoredUsers } from './browserStorage';

test('collects public contacts from profile, social accounts and README with sources', () => {
    const contacts = extractContacts({
        profile: { login: 'alice', email: 'alice@example.com', bio: 'Discord: alice#1234; Telegram: @alice_dev; Phone: +1 (212) 555-1234', blog: 'example.com' },
        socialAccounts: [{ provider: 'linkedin', url: 'https://www.linkedin.com/in/alice' }],
        readme: 'Reach alice@example.com or https://t.me/alice_dev\n[Book a call](https://example.com/contact)\nhttps://discord.gg/community',
    });
    expect(contacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'Discord', value: 'alice#1234', url: '' }),
        expect.objectContaining({ type: 'Telegram', value: 'alice_dev', url: 'https://t.me/alice_dev' }),
        expect.objectContaining({ type: 'Phone', value: '+12125551234', url: 'tel:+12125551234' }),
        expect.objectContaining({ type: 'Website', value: 'https://example.com' }),
        expect.objectContaining({ type: 'LinkedIn' }),
        expect.objectContaining({ type: 'Contact link' }),
    ]));
    const emails = contacts.filter((c) => c.type === 'Email');
    expect(emails).toHaveLength(1);
    expect(emails[0].sources).toHaveLength(2);
});

test('avoids unlabeled numbers, noreply addresses, arbitrary repo links and unsafe links', () => {
    expect(extractContacts({ profile: { bio: '1234567890 2026-09-21 abc@users.noreply.github.com https://github.com/a/project', blog: 'javascript:alert(1)' } })).toEqual([]);
    expect(safeContactUrl('javascript:alert(1)')).toBe('');
    expect(safeContactUrl('data:text/html,hello')).toBe('');
});

test('recognizes Markdown labels and obfuscated email and deduplicates Telegram links', () => {
    const contacts = extractContacts({ profile: { bio: '**Phone:** +1 212 555 1234\nTelegram: @alice_dev\nalice [at] example [dot] com https://t.me/alice_dev' } });
    expect(contacts.filter((c) => c.type === 'Telegram')).toHaveLength(1);
    expect(contacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'Email', value: 'alice@example.com' }),
        expect.objectContaining({ type: 'Phone', value: '+12125551234' }),
    ]));
});

test('handles social links and optional source failures without dropping profile contacts', async () => {
    const get = jest.fn().mockResolvedValueOnce({ data: [{ provider: 'signal', url: 'https://signal.me/#p/+12125551234' }] })
        .mockRejectedValueOnce({ response: { status: 500 } });
    const result = await discoverContacts({ login: 'alice', email: 'alice@example.com' }, get);
    expect(result.contactLookupIncomplete).toBe(true);
    expect(result.contacts.map((c) => c.type)).toEqual(['Email', 'Signal']);
});

test('missing profile README is normal, and raw Unicode README text is supported', async () => {
    const get = jest.fn().mockResolvedValueOnce({ data: [] }).mockRejectedValueOnce({ response: { status: 404 } });
    expect((await discoverContacts({ login: 'alice' }, get)).contactLookupIncomplete).toBe(false);
    expect(extractContacts({ readme: 'こんにちは Telegram: @alice_dev' })[0].value).toBe('alice_dev');
});

test('refreshing an existing saved user preserves other users and updates contacts', () => {
    localStorage.clear();
    saveStoredUsers([{ id: 'alice', login: 'alice', name: 'Alice' }, { id: 'bob', login: 'bob' }]);
    mergeStoredUsers([{ id: 'alice', login: 'alice', contacts: [{ type: 'Discord', value: 'alice' }] }]);
    expect(loadStoredUsers()).toHaveLength(2);
    expect(loadStoredUsers()[0]).toMatchObject({ name: 'Alice', contacts: [{ type: 'Discord', value: 'alice' }] });
});
