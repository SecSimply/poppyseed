# Protea Bank demo script

About 15 minutes. It shows five things a personal agent and a company can do with the Personal Agent Protocol, using the Poppy Inspector as the agent and Protea Bank as the company. Nothing is real: the bank, the money and the customers are fictional.

**You need**

- The Inspector, signed in with Curity: `https://poppyseed-inspector-production.up.railway.app`
- Protea Bank: `https://app.proteabank.co.za`
- A second browser window (a private window, so it doesn't share cookies) signed in to Protea Bank as the customer: open the site, choose **Account**, and sign in with the Curity user that is mapped to Thandi. This is the person.
- The staff console, in a third window of its own: open the site, choose **Staff**, and sign in with a Curity user listed in `STAFF_EMAILS`. If Curity is down, the emergency key still works: `/staff?key=…`, the `POPPY_STAFF_KEY` variable on the `nova-bank` Railway service.
- The Inspector's settings for this demo, set once: `SIGNIN_SCOPES=accounts:read transactions:read payments:write`, `BROWSE_PATHS=/account /payments /payees /staff`, `STANDING_PERMISSION=1`, and two `OPERATIONS` presets (a small payment and a large one). The README lists them.

**Before you start:** open `/staff` and make sure nobody is blocked. After the Inspector is redeployed, wait 30 seconds before the first run: the bank still holds its old keys for that long and answers `invalid_client`.

Say at the start: *"The Inspector is a personal agent that shows its working. Every request it makes is on the right. The bank is a company that has decided what an agent may do."*

---

## 1. Sign in (authentication)

1. In the Inspector, click **Run journey**. No person is needed yet.
2. Point at the steps as they pass: discover, read the excluded tasks, start a Session, list tools, call a public tool. *"Without signing in, an agent can already read our rates and find a branch. It cannot see anyone's money."*
3. Click **Run with sign-in and operations**. The Inspector shows a link and a code.
4. In the customer's window, open the link, check the code matches, read the scopes, and **Approve**. Only the signed-in customer can: the page needs their Curity sign-in.
5. Back in the Inspector: **Sign a person in** passes. Open **Call a scoped tool**: it returns Thandi's balances.

*Point to make:* the agent never saw a password. The customer approved exactly the scopes listed, in the bank's own page.

## 2. A person approves what matters (human in the loop)

1. Run with sign-in again and choose **Pay Boland Power R1 735,00** in the operation picker.
2. Approve the sign-in. The payment is proposed, and because the customer set a standing permission for small payments, it goes through. Open **The person decides**: *"within your standing permission"*, then *"Paid R1 735,00 to Boland Power"*.
3. Run again with **Pay Dwarsrivier Rentals R14 500,00 (needs your approval)**. An **Approve this yourself** panel appears. *"Over R5 000 the bank refuses a standing permission. The agent can't approve it for the customer."*
4. Click **Decline** once to show nothing moves. Run again and **Approve** to show the payment going through, as the customer, not the agent.
5. In the customer's window, open **Payments**: both payments are there.

*Point to make:* the bank draws the line, in its own code, and the protocol makes the agent honour it.

## 3. The agent browses the site

1. In the Inspector run from step 1 or 2, open the **Browse the site as the agent** step.
2. Read it out: the agent's browser joined its Session, then loaded `/account`, `/payments` and `/payees`. Each page opens with *"A personal agent is viewing this page"* and shows what the Session's scopes allow.
3. Point at `/staff → 404`: *"The staff console doesn't exist for an agent's browser."*
4. Optional: run again with `SIGNIN_SCOPES` set to `accounts:read` only. `/payments` now says it needs `transactions:read`. *"The page and the tools follow the same rules. There is no back door in the website."*

## 4. Support chat, and a person behind it

1. Open **Ask the company's agent** from the run: it answered the rates question by calling the bank's own tool.
2. Open **Ask the company's agent about your account**: Thandi's balances, read under the Session's scopes.
3. Open **Ask for a person**. In the staff window, refresh: the conversation is waiting. Click **Take it**, write a reply as support, and send it.
4. Back in the Inspector, nothing needs to change: the conversation now has a human on it. *"Same conversation, same protocol, a person instead of the assistant."*

## 5. What the bank will not do, and who it refuses

**Excluded tasks**

1. Open the **Read the tasks it won't offer** step: three tasks (add a payee, close an account, send an international payment), each with where to do it instead.
2. Open **Ask it for a task it won't offer**: the company's own agent declines the first one and gives the same alternative. *"The list is promised on every interface."*
3. In the customer's window, open **Payees**: Thandi can add a payee. In the Inspector's browse step, the same page for the agent has no form.

**Blocking an agent**

1. In the staff window, open **Blocked agents**. Paste the Inspector's agent address (shown at the top of the Inspector, after *Agent*) and click **Block**.
2. In the Inspector, click **Run journey**. The Session step fails: `invalid_client`, *client is blocked*. The hint says it is the bank's decision, not a fault in the agent's keys.
3. Click **Unblock** in the staff window and run again: it passes.

*Point to make:* a company can refuse a particular agent, and an agent can tell that from a bug. A Session the agent already holds keeps working until its token expires (an hour by default).

---

## Afterwards

- The bank keeps everything in memory. **Restarting `nova-bank` resets the payments, the payees, the blocked list and the reports.** Do that before a demo if you want a clean start.
- Every longer run leaves one waiting conversation in the staff queue. Take or ignore them.
- **If the Inspector shows `invalid_client` on the first run** and the bank has not blocked it, wait 30 seconds and run again.

## What this does not show

Mediated Sign-In (the agent types the customer's password) is off on purpose: a bank should not teach customers to hand over a password. Direct Sign-In, where the customer approves in a redirect, works but the Inspector shows the Device flow.
