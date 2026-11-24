export const displayPairingStates = ['UNPAIRED', 'RECOVERY_REQUESTED', 'PAIRING_PENDING', 'PAIRED', 'PAIRING_FAILED', 'REMOVAL_PENDING'] as const
export type DisplayPairingState = (typeof displayPairingStates)[number]

/** Only a heartbeat authenticated by the current device token completes pairing. */
export function pairingStateAfterAuthenticatedHeartbeat(pairingStatus: string, displayState: string): DisplayPairingState {
  if (['DISABLED', 'DELETED'].includes(displayState)) return 'UNPAIRED'
  if (pairingStatus === 'REMOVAL_PENDING') return 'REMOVAL_PENDING'
  if (displayState === 'UNPAIRED') return 'UNPAIRED'
  if (pairingStatus === 'PAIRING_PENDING' || pairingStatus === 'PAIRING_FAILED') return 'PAIRED'
  return displayPairingStates.includes(pairingStatus as DisplayPairingState) ? pairingStatus as DisplayPairingState : 'UNPAIRED'
}

export function pairingStateAfterAdminRecoveryRequest(_current: string): DisplayPairingState { return 'RECOVERY_REQUESTED' }
