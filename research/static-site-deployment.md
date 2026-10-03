# Deployment choice for azeforge.com

**Recommendation for the current closed preview:** run the complete application on one `linux/amd64` VPS with Caddy as its TLS reverse proxy. Hostinger KVM 2 currently meets the memory requirement within a $20/month operating budget after renewal, while AWS does not. Set `AZEWEB_MAX_RUNNING_JOBS=1`, do not configure TeX, and do not add a CDN or separate static origin. This follows the repository's one-container-on-an-owner-controlled-VM deployment model. Re-evaluate a static/object-store split only when traffic or availability needs justify it.

**Researched:** 2026-10-02. External links are provider documentation or pricing pages.

## What this repository can publish

`npm run build:public` generates `public/`. The build script describes that directory as standalone, with no dependency on the service or authoring application. It is a valid static-hosting artifact.

It is not the entire product. The repository also has `/playground` and `/v1`, served by a Node container. That container includes a pinned browser, needs writable `/scratch` and `/tmp`, and the documented deployment assigns it 6 GiB of memory. Static hosting can publish `public/`, but cannot replace that runtime. This note does not estimate the container host, because its AWS service and traffic profile have not been selected.

### Hostinger KVM 2, recommended for the budget-constrained closed preview

- **Capacity.** KVM 2 has 2 vCPU, 8 GB RAM, 100 GB NVMe storage, and 8 TB bandwidth. It is an x86 AMD EPYC VPS with root access, so it can run the repository's required `linux/amd64` Docker image. KVM 1 has only 4 GB RAM and is not suitable for the documented 6 GiB container limit. [Hostinger VPS plans](https://www.hostinger.com/in/vps-hosting)
- **Cost.** The India pricing page currently advertises KVM 2 at ₹799/month and says it renews at ₹1,199/month. It also states that all plans are paid upfront, so confirm the required initial term and final checkout total before buying. ₹1,199/month is below a $20 monthly operating cap at normal INR/USD exchange rates, excluding independent AI-provider spending. [Hostinger VPS plans](https://www.hostinger.com/in/vps-hosting)
- **Operations.** Choose a plain Linux image rather than a panel, run Caddy on ports 80/443, and bind the application container to loopback. The plan includes weekly backups, but application jobs and artifacts are deliberately ephemeral; use backups for host configuration and deployment material, not job data. [Hostinger VPS plans](https://www.hostinger.com/in/vps-hosting)

## Costs and constraints

### AWS S3 + CloudFront + Route 53 + ACM, recommended for the full product

- **Shape.** Store `public/` in a private regular S3 bucket, use CloudFront Origin Access Control, and make CloudFront the single public entry point. CloudFront supports multiple origins and path-based cache behaviors, so its default behavior can serve S3 while `/playground*` and `/v1*` reach the container origin. Use a non-caching behavior for the authenticated API. AWS recommends OAC for S3 origins, and an OAC cannot protect an S3 website endpoint. [CloudFront origins and behaviors](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html) [S3 origin access control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- **Recurring costs.** On pay-as-you-go, S3 bills storage and requests, CloudFront bills delivery and requests, and Route 53 bills the first 25 hosted zones at $0.50 per zone-month. Route 53 does not charge queries for Alias A/AAAA records targeting CloudFront. The current CloudFront flat-rate Free plan is also $0 and includes 5 GB S3 storage, 100 GB delivery, and 1 million requests per distribution. Choose a billing model deliberately. It does not pay for the Node container. [S3 pricing](https://aws.amazon.com/s3/pricing/) [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/) [Route 53 pricing](https://aws.amazon.com/route53/pricing/)
- **One-time and annual costs.** Initial upload creates S3 requests. Domain registration and renewal are annual and TLD-specific. ACM's non-exportable public certificate has no charge when used by an integrated AWS service. [Route 53 domain pricing](https://aws.amazon.com/route53/pricing/) [ACM pricing](https://aws.amazon.com/certificate-manager/pricing/)
- **Custom domain and TLS.** Add `azeforge.com` and `www.azeforge.com` as CloudFront alternate domain names, attach a certificate that covers both names, and create Route 53 Alias records. For viewer HTTPS, ACM certificates used with CloudFront must be requested in `us-east-1`. [CloudFront custom domains](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html) [CloudFront certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html)
- **Operations.** Maintain IAM, S3 bucket policy/OAC, cache and origin-request policies, certificate validation, DNS, and cache invalidation on release. Keep the S3 bucket private. The public and API behaviors need different caching and request-forwarding rules.

### Cloudflare Pages, cheapest for `public/` alone

- **Cost.** Static-asset requests are free and unlimited on Free and paid plans. Pages Functions are Worker requests, not free static delivery, and they are not a replacement for this containerized Node service. [Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- **Custom domain and TLS.** Pages accepts custom domains. An apex domain requires adding the zone to Cloudflare and delegating its nameservers; a subdomain can CNAME to Pages without that delegation. Cloudflare automatically issues and renews free publicly trusted certificates for active domains. [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/) [Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/)
- **Constraints and one-time work.** A Free project permits 20,000 files, files up to 25 MiB, 500 builds per month, one concurrent build, and 20-minute builds. Direct Upload accepts a prebuilt directory, but a Direct Upload project cannot later switch to Git integration. Create the project, publish `public/`, add the domain in Pages, then change DNS. Domain renewal remains separate. [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

### GitHub Pages, viable only for a non-commercial public bundle

- **Cost and domain/TLS.** GitHub Pages is a static site host for HTML, CSS, and JavaScript from a repository. It supports custom apex domains and HTTPS enforcement. Publishing is subject to the GitHub plan and repository eligibility, so do not assume a zero bill for private-source CI. [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) [Custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) [HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
- **Constraints.** GitHub says Pages is not for free hosting of an online business, e-commerce site, or commercial SaaS. It has a 1 GB published-site limit, 100 GB/month soft bandwidth limit, and 10-minute deployment timeout. It cannot host the Node service. [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## Decision

For the full product, use a single Hostinger KVM 2 VPS for the closed preview. It gives the application its required 8 GiB host budget, fits the $20 recurring limit at the advertised renewal rate, and avoids unnecessary CDN, object-storage, and proxy-origin infrastructure. Its 2 vCPU limit requires one concurrent compile only.

Use AWS only when its higher recurring cost is acceptable. For a static-only public bundle with no Playground or `/v1`, Cloudflare Pages remains the least-cost option.
