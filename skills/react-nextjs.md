# Skill: React / Next.js (Desarrollo Web Moderno)

Trigger: el usuario pide una app web moderna, SPA, dashboard con React, Next.js, 
componentes reutilizables, estado global, routing, o integración con APIs.

- Preferí Next.js para apps completas (routing, SSR, API routes) y React puro para 
  componentes o SPAs simples.
- Para componentes: separá lógica de presentación (hooks custom para lógica, 
  componentes puros para UI).
- Estado: usá Context API o Zustand para estado global, nunca prop drilling excesivo.
- Para forms: usá React Hook Form + Zod para validación (type-safe, performante).
- Para fetching: usá SWR o React Query para caché, revalidación y optimistic updates.
- Para styling: usá Tailwind CSS (utility-first) o styled-components (component-scoped).
- Para routing en Next.js: usá App Router (app/) para nuevos proyectos, Pages Router 
  (pages/) solo si es necesario.
- Para APIs: usá Server Actions (Next.js 13+) o API routes, nunca fetch directo desde 
  componente sin error handling.
- Para performance: usá React.memo(), useMemo(), useCallback() solo cuando sea 
  necesario (profilea antes de optimizar).
- Para SEO: usá metadata API en Next.js, nunca meta tags manuales.
- Para deployment: usá Vercel (Next.js) o Netlify (React), con CI/CD automático.
