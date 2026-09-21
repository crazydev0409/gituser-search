import { fireEvent, render, screen } from '@testing-library/react';
import ContactList from './ContactList';

test('renders contact, evidence link and copies a handle without inventing a profile URL', () => {
    const writeText = jest.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ContactList user={{ contacts: [{ key: 'discord:alice', type: 'Discord', value: 'alice', url: '', sources: ['https://github.com/alice'] }] }} />);
    expect(screen.getByText('alice').closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://github.com/alice');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Discord: alice' }));
    expect(writeText).toHaveBeenCalledWith('alice');
});

test('old saved users without contacts remain renderable', () => {
    const { container } = render(<ContactList user={{ email: 'alice@example.com' }} />);
    expect(container).toBeInTheDocument();
});
