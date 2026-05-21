import { serviceProviderMetadata } from "@/lib/saml";

/** SP metadata document — register this URL with the identity provider. */
export function GET() {
  return new Response(serviceProviderMetadata(), {
    headers: { "Content-Type": "application/xml" },
  });
}
