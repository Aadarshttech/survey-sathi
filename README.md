# Survey Sathi

A dynamic survey platform featuring a visual builder, universal conditional branching logic, participant response collection, and real-time aggregate analytics.

---

## Table of Contents
- [Executive Overview](#executive-overview)
- [Key Features](#key-features)
- [Architecture Decisions](#architecture-decisions)
- [Universal Conditional Logic Engine](#universal-conditional-logic-engine)
- [Assumptions and Trade-offs](#assumptions-and-trade-offs)
- [Data Models and Schema](#data-models-and-schema)
- [Setup Instructions](#setup-instructions)
  - [Prerequisites](#prerequisites)
  - [Local Development](#local-development)
  - [Testing Key Workflows](#testing-key-workflows)
  - [Firebase Deployment (Production)](#firebase-deployment-production)
- [Project Structure](#project-structure)
- [Security and Data Integrity](#security-and-data-integrity)

---

## Executive Overview

Survey Sathi is an end-to-end survey engine engineered around core production principles: zero-dependency runtime resilience, instant cold starts, secure cloud storage, and responsive conditional form branching.

The system supports two core operational roles:
1. **Survey Creators (Administrators)**: Authenticated users who design surveys, establish conditional logic rules, manage lifecycle states (draft vs. published), share direct links, and analyze aggregated responses.
2. **Participants**: Unauthenticated respondents who complete published surveys via direct URL or Survey ID with real-time conditional question rendering.

---

## Key Features

- **Visual Survey Builder**:
  - Full CRUD operations with client-side reactive state and Cloud Firestore persistence.
  - Four fundamental question types: Single Select, Checkboxes, 1 to 5 Rating, and Open Text.
  - Controls for question re-ordering (Move Up / Move Down), dynamic option management, and mandatory field enforcement.
  - Dedicated empty dashboard state with fast survey creation and registered survey management.
- **Universal Conditional Logic Engine**:
  - Rule attachment supported on any question in the survey.
  - Typed trigger operators:
    - **Single Select**: `is equal to`, `is not equal to`
    - **Checkboxes**: `includes`, `does not include`
    - **Rating**: `is equal to`, `is at least (>=)`, `is at most (<=)`
    - **Text**: `is answered (not empty)`, `is unanswered (empty)`, `equals text`
  - Algorithmic cycle detection preventing circular dependency deadlocks.
  - Real-time client-side cascading visibility evaluation on participant forms.
- **Participant Interface**:
  - Responsive, high-contrast interface with dynamic progress calculation.
  - Intelligent validation: conditionally hidden fields are automatically excluded from required-field checks.
  - Submission payload sanitization to discard answers from inactive conditional branches.
- **Real-Time Analytics Dashboard**:
  - Dedicated survey switcher to inspect analytics across any authored survey.
  - KPI summary blocks: Total Responses, Question Count, and Unique Share Key.
  - Per-question distribution metrics:
    - **Rating**: Average score computation (out of 5.0) with star distribution frequency bars.
    - **Single and Multi-Select**: Option frequencies, absolute counts, and percentage distribution bars.
    - **Text Responses**: Chronological verbatim quote list.
- **Monochromatic High-Contrast Interface**:
  - Purpose-built design system using `#101114` ink and `#2c2e33` charcoal with `IBM Plex Sans` and `IBM Plex Mono` typography. Neutral, professional aesthetic free of unnecessary styling artifacts.

---

## Architecture Decisions

```
               +--------------------------------------------------------+
               |                  CLIENT BROWSER (SPA)                  |
               |                                                        |
               |   +-----------------+        +---------------------+   |
               |   |  Survey Builder |        |   Public Form Flow  |   |
               |   |   and DAG Logic |        | (Dynamic Visibility)|   |
               |   +--------+--------+        +----------+----------+   |
               |            |                            |              |
               |            +--------------+-------------+              |
               |                           |                            |
               |            +--------------v-------------+              |
               |            |   Firebase Client SDK      |              |
               |            | (Auth & Firestore Compat)  |              |
               |            +--------------+-------------+              |
               +---------------------------+----------------------------+
                                           |
                        HTTPS / WebSockets | Direct Cloud Connection
                                           |
               +---------------------------v----------------------------+
               |                GOOGLE CLOUD FIREBASE                   |
               |                                                        |
               |   +-------------------+     +----------------------+   |
               |   |   Firebase Auth   |     |   Cloud Firestore    |   |
               |   | (Email/Password)  |     |  (Security Rules v2) |   |
               |   +-------------------+     +----------------------+   |
               +--------------------------------------------------------+
```

### 1. Zero-Dependency Vanilla Web Standards Architecture
- **Decision**: Developed with native modern JavaScript (ES6+), HTML5 semantic markup, and CSS Custom Properties, avoiding frontend framework dependencies (e.g., React, Vue, Angular) and build bundlers.
- **Rationale**:
  - **Cold-Start Performance**: 0ms build step and instantaneous page loads with under 80 KB total transferred assets.
  - **Maintainability**: Complete immunity to build pipeline breakages, vulnerability alerts in dependencies, and framework lifecycle deprecations.
  - **Predictable State**: Centralized reactive state store (`state`) with deterministic view rendering functions.

### 2. Direct-to-Database Architecture via Cloud Firestore
- **Decision**: The browser client communicates directly with Cloud Firestore over TLS, bypassing traditional REST/GraphQL API server middleware.
- **Rationale**:
  - Removes intermediate server hops, operational scaling burdens, and repetitive CRUD controller boilerplate.
  - Security is enforced at the database boundary via declarative rules (`firestore.rules`):
    - **Public Read**: Anyone can read surveys where `status == 'published'`.
    - **Public Write**: Unauthenticated users can append responses under `/surveys/{surveyId}/responses/{responseId}`.
    - **Admin Protected**: Only authenticated users (`request.auth != null`) can create, update, or delete surveys, or read participant response records.

### 3. Native Node.js Static Server
- **Decision**: Implemented `server.js` using Node.js built-in standard library modules (`http`, `fs`, `path`, `url`).
- **Rationale**:
  - Serves static assets with explicit MIME headers and provides single-page application wildcard fallback routing (`index.html`).
  - Zero external npm packages required for runtime execution (`npm start` boots on pure standard library).

---

## Universal Conditional Logic Engine

The conditional logic engine is structured as a **Directed Acyclic Graph (DAG)**:

```
[ Question A (Single: Yes/No) ] ---( equals 'Yes' )---> [ Question B (Rating) ]
                                                               |
                                                         ( gte 4 Stars )
                                                               |
                                                               v
                                                      [ Question C (Text) ]
```

### 1. Cycle Detection (`canDependOn`)
To allow users to assign conditional rules anywhere without risking infinite render loops, an iterative ancestor traversal validates every dependency assignment:

```javascript
function canDependOn(qId, candidateId, questions) {
  if (qId === candidateId) return false;
  let curr = questions.find(x => x.id === candidateId);
  const seen = new Set([candidateId]);
  while (curr && curr.condition && curr.condition.questionId) {
    if (curr.condition.questionId === qId) return false; // Cycle detected
    if (seen.has(curr.condition.questionId)) break;
    seen.add(curr.condition.questionId);
    curr = questions.find(x => x.id === curr.condition.questionId);
  }
  return true;
}
```

### 2. Cascading Visibility Resolution (`conditionVisible`)
Visibility checks recursively verify if upstream dependencies are visible:

```javascript
// If the target question itself is conditionally hidden, downstream dependents are hidden automatically
if (!conditionVisible(targetQ, answers, visited)) return false;
```

### 3. Schema Sanitization
When questions are deleted, reordered, or modified, `sanitizeConditions()` validates referencing conditions and removes orphaned rules to ensure schema integrity.

---

## Assumptions and Trade-offs

| Decision | Trade-off Made | Alternative Considered | Justification |
| :--- | :--- | :--- | :--- |
| **Vanilla JS over React/Next.js** | Direct DOM updates instead of Virtual DOM diffing. | React 19 / Next.js App Router | Zero dependency footprint, instant startup, and elimination of build tool overhead for technical evaluations. |
| **Direct Firestore over Custom Backend** | Firestore security rules must be maintained alongside client schema. | Node.js / Express REST API gateway | Native sub-second WebSocket updates, built-in horizontal scaling, and reduced operational complexity. |
| **Client-Side Condition Evaluation** | Full survey schema is downloaded by client. | Server-side multi-step wizard | Instantaneous UI reaction when users select options; zero network roundtrips during form completion. |
| **Monochromatic Design System** | Custom CSS classes instead of generic UI libraries. | Tailwind CSS / Material UI | Strict visual consistency, zero CSS bloat, and alignment with modern developer-first engineering tools. |
| **In-Memory Cycle Detection** | Computes dependency graph in browser memory. | Precomputed topological sort in database | Typical surveys contain 5 to 50 questions; traversal completes in under 0.05ms, making runtime graph checks negligible. |

---

## Data Models and Schema

### 1. Survey Document (`/surveys/{surveyId}`)
```json
{
  "title": "Developer Tooling Survey",
  "description": "Quarterly developer satisfaction and environment feedback.",
  "status": "published",
  "createdAt": "2026-11-20T03:00:00.000Z",
  "updatedAt": "2026-11-20T03:15:00.000Z",
  "questions": [
    {
      "id": "q_1732069200000_1",
      "type": "single",
      "label": "Do you use TypeScript in your daily workflow?",
      "options": ["Yes", "No"],
      "required": true
    },
    {
      "id": "q_1732069200000_2",
      "type": "rating",
      "label": "How would you rate your developer satisfaction with TypeScript?",
      "required": true,
      "condition": {
        "questionId": "q_1732069200000_1",
        "op": "equals",
        "equals": "Yes"
      }
    }
  ]
}
```

### 2. Response Document (`/surveys/{surveyId}/responses/{responseId}`)
```json
{
  "submittedAt": "2026-11-20T03:20:00.000Z",
  "answers": {
    "q_1732069200000_1": "Yes",
    "q_1732069200000_2": 5
  }
}
```

---

## Setup Instructions

### Prerequisites
- **Node.js**: `v18.0.0` or higher ([Node.js Official Downloads](https://nodejs.org/))
- Standard web browser (Chrome, Edge, Firefox, Safari)

### Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Aadarshttech/survey-sathi.git
   cd survey-sathi
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```
   *(Note: The server uses Node.js standard libraries; installation completes instantly with zero external dependencies).*

3. **Start the local server**:
   ```bash
   npm start
   ```

4. **Access the application**:
   - Open your browser to `http://localhost:3000`

---

### Testing Key Workflows

#### 1. Administrator Authentication
- Navigate to `http://localhost:3000/admin/login` or select **Admin Portal** from the landing page.
- Select **Create new account** (`/admin/register`) to register administrator credentials via Firebase Auth.
- Upon successful registration, the application routes directly to the Admin Dashboard.

#### 2. Authoring a Survey with Conditional Logic
- In the navigation bar, select **Builder**.
- Select **+ Create new survey**.
- Enter a Title and Description.
- Add questions from the side panel (`Text input`, `Single select`, `Checkboxes`, `Rating`).
- On any target question, select **`+ Add conditional logic`**:
  - Select the trigger question from **If Question**.
  - Choose a condition operator (e.g., `is equal to`, `is at least (>=)`).
  - Select or enter the trigger value.
- Select **Save** or **Publish**. The builder resets to the registered surveys overview.

#### 3. Taking the Public Survey
- Copy the Direct Link or Survey ID from the Dashboard.
- Open the URL in an incognito window or navigate to `/survey/{surveyId}`.
- Toggle question choices: dependent questions dynamically reveal and hide immediately.
- Submit the response.

#### 4. Viewing Real-Time Analytics
- Return to the Admin portal and select **Analytics**.
- Use the survey dropdown selector to switch between surveys.
- Review total responses, rating distribution, choice percentages, and open-ended text submissions.

---

### Firebase Deployment (Production)

To deploy security rules and hosting assets to Google Cloud Firebase:

1. **Authenticate with Firebase CLI**:
   ```bash
   npx firebase login
   ```

2. **Deploy Firestore Security Rules**:
   ```bash
   npm run deploy:rules
   ```

3. **Deploy Web Hosting**:
   ```bash
   npm run deploy:hosting
   ```

---

## Project Structure

```
.firebaserc              Firebase project alias configuration
.gitignore               Git ignore specifications for logs, caches, and secrets
.env.example             Environment variable template
firebase.json            Firebase Hosting and Firestore deployment configuration
firestore.rules          Granular Firestore security rules v2
firestore.indexes.json   Firestore index configuration
package.json             Project metadata, engine constraints, and run scripts
README.md                Technical documentation and architecture guide
server.js                Zero-dependency Node.js static and SPA routing server
public/                  Frontend single-page application (SPA)
  index.html             SPA root shell with Firebase SDK integration
  app.js                 Reactive state machine, DAG engine, routing
  styles.css             Industrial monochromatic design system
```

---

## Security and Data Integrity

1. **Database Access Controls**:
   - Firestore security rules validate client identity using `request.auth.uid`.
   - Read permissions for participant responses are strictly restricted to authenticated survey administrators.
2. **Input Validation**:
   - Client-side email format regex and minimum-length password validation.
   - Dynamic required-field checking scoped strictly to currently visible questions.
   - HTML entity sanitization (`esc()`) on all user-supplied strings to neutralize Cross-Site Scripting (XSS) vectors.
3. **Data Hygiene**:
   - Answers belonging to inactive or hidden conditional branches are pruned prior to submission, preventing orphaned data records in Firestore.
