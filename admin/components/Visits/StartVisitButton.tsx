import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { Storefront } from '@phosphor-icons/react';
import { toast } from 'react-toastify';
import { visitService } from '../../services/visitService';

interface StartVisitButtonProps {
  dealerId: string;
  clientName?: string;
  /** 'button' for a full call-to-action, 'link' for a compact inline action in a table. */
  variant?: 'button' | 'link';
  className?: string;
  label?: string;
}

function extractApiMessage(error: unknown): string | null {
  if (error && typeof error === 'object' && 'response' in error) {
    return (error as { response?: { data?: { message?: string } } }).response?.data?.message ?? null;
  }
  return null;
}

/**
 * Lets a rider start a visit at any client they can see, without waiting for it to be
 * assigned to their route. The created visit is ordinary in every other respect, so this
 * just drops them into the normal check-in screen.
 *
 * If a visit for this client already exists today, the backend returns that one instead
 * of creating a duplicate — the rider is simply taken to wherever it already is.
 */
const StartVisitButton: React.FC<StartVisitButtonProps> = ({
  dealerId,
  clientName,
  variant = 'button',
  className,
  label = 'Start Visit',
}) => {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    setStarting(true);
    try {
      const { visit, created } = await visitService.startSelfVisit(dealerId);
      toast.success(
        created
          ? `Visit started${clientName ? ` at ${clientName}` : ''}. Check in when you arrive.`
          : 'You already have a visit here today — opening it.',
      );
      router.push(`/visits/${visit._id}/edit`);
    } catch (error) {
      toast.error(extractApiMessage(error) || 'Could not start a visit for this client');
      setStarting(false);
    }
    // Deliberately not clearing `starting` on success — the page is navigating away and
    // re-enabling the button would let an impatient double-tap fire a second request.
  };

  if (variant === 'link') {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleStart();
        }}
        disabled={starting}
        title={`Start a visit at ${clientName ?? 'this client'}`}
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          background: 'none',
          border: 'none',
          padding: 0,
          color: '#0f766e',
          fontSize: '0.8125rem',
          fontWeight: 600,
          cursor: starting ? 'wait' : 'pointer',
          textDecoration: 'underline',
        }}
      >
        <Storefront size={14} weight="bold" aria-hidden />
        {starting ? 'Starting…' : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleStart}
      disabled={starting}
      title={`Start a visit at ${clientName ?? 'this client'}`}
      className={className}
    >
      <Storefront size={20} weight="bold" aria-hidden />
      {starting ? 'Starting…' : label}
    </button>
  );
};

export default StartVisitButton;
