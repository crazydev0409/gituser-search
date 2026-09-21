import { Copy } from 'lucide-react';
import { toast } from 'react-toastify';
import { safeContactUrl } from '../utils/contacts';

export default function ContactList({ user }) {
    const contacts = user.contacts || [];
    const copy = async (value) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success('Contact copied!');
        } catch { toast.error('Failed to copy contact'); }
    };
    return <div className="space-y-2 my-3 text-xs">
        {contacts.map((contact) => <div key={contact.key} className="break-words">
            <div className="flex items-center gap-2">
                <span className="font-medium text-gray-600">{contact.type}</span>
                <button type="button" onClick={() => copy(contact.value)} title={`Copy ${contact.type}`} aria-label={`Copy ${contact.type}: ${contact.value}`}><Copy size={12} /></button>
            </div>
            {safeContactUrl(contact.url) ? <a className="text-indigo-600 hover:underline" href={safeContactUrl(contact.url)} target="_blank" rel="noopener noreferrer">{contact.value}</a> : <span>{contact.value}</span>}
            {contact.sources?.filter((source) => safeContactUrl(source)).map((source, index) => <a key={source} href={safeContactUrl(source)} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:underline ml-2">Source{index ? ` ${index + 1}` : ''}</a>)}
        </div>)}
        {user.contactLookupIncomplete && <p className="text-amber-700">Some contact sources could not be checked. Retry Find Contacts.</p>}
    </div>;
}
