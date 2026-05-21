// KYC provider abstraction.
//
// A real implementation wraps Stripe Identity, Persona, Onfido, etc. The
// `StubKycProvider` below AUTO-APPROVES every verification — it exists so the
// rest of the system is testable. It must be replaced before production; see
// STATUS.md.

export interface KycCheckResult {
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  providerRef: string;
  rejectionReason?: string;
}

export interface KycProvider {
  readonly name: string;
  // Start an identity verification session for a seller.
  startVerification(input: {
    sellerProfileId: string;
    legalName: string;
  }): Promise<KycCheckResult>;
  // Poll/refresh the status of an existing session.
  checkStatus(providerRef: string): Promise<KycCheckResult>;
}

class StubKycProvider implements KycProvider {
  readonly name = 'stub';

  async startVerification(input: { sellerProfileId: string }): Promise<KycCheckResult> {
    return { status: 'PENDING', providerRef: `stub_${input.sellerProfileId}` };
  }

  // PLACEHOLDER: always verifies. Replace with a real provider.
  async checkStatus(providerRef: string): Promise<KycCheckResult> {
    return { status: 'VERIFIED', providerRef };
  }
}

export const kycProvider: KycProvider = new StubKycProvider();
