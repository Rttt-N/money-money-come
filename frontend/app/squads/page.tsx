"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useSquad } from "@/hooks/useSquad";
import { useUserInfo } from "@/hooks/useUserInfo";
import {
  Users,
  Plus,
  LogIn,
  LogOut,
  Copy,
  CheckCircle2,
  Loader2,
  Shield,
  Crown,
  AlertTriangle,
} from "lucide-react";

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function SquadsPage() {
  const { address } = useAccount();
  const { squadId, squadInfo, createSquad, joinSquad, leaveSquad, isPending, isSuccess, refetch } =
    useSquad();
  const { userInfo } = useUserInfo();

  const [joinIdInput, setJoinIdInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [action, setAction] = useState<"none" | "create" | "join" | "leave">("none");
  const [done, setDone] = useState<"none" | "created" | "joined" | "left">("none");
  const [txError, setTxError] = useState("");

  const isInSquad = squadId !== undefined && squadId !== 0n;
  const isLoading = isPending || (action !== "none" && !isSuccess);

  async function handleCreate() {
    setAction("create");
    try {
      await createSquad();
      setDone("created");
      await refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setAction("none");
    }
  }

  async function handleJoin() {
    // NEW-FM-6: guard against non-numeric input
    let id: bigint;
    try {
      id = BigInt(joinIdInput || "0");
    } catch {
      return; // invalid input, ignore
    }
    if (id === 0n) return;
    setAction("join");
    setTxError("");
    try {
      await joinSquad(id);
      setDone("joined");
      await refetch();
    } catch (err: unknown) {
      console.error(err);
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
        || (err as { message?: string })?.message || "";
      if (msg.includes("not active")) {
        setTxError("This squad does not exist or is no longer active.");
      } else if (msg.includes("already in a squad")) {
        setTxError("You are already in a squad. Leave your current squad first.");
      } else if (msg.includes("squad full")) {
        setTxError("This squad is full (max 10 members).");
      } else {
        setTxError("Failed to join squad. Please check the Squad ID and try again.");
      }
    } finally {
      setAction("none");
    }
  }

  async function handleLeave() {
    setAction("leave");
    try {
      await leaveSquad();
      setDone("left");
      await refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setAction("none");
    }
  }

  function copySquadId() {
    if (!squadId) return;
    navigator.clipboard.writeText(squadId.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!address) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="glass-card max-w-md w-full p-10 text-center">
          <div className="mb-4 text-5xl">🔒</div>
          <h2 className="mb-2 text-xl font-bold text-white">Connect Your Wallet</h2>
          <p className="text-white/50">Connect your wallet to manage your squad.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      {/* Header */}
      <div className="mb-10">
        <h1 className="mb-2 text-3xl font-bold text-white">Luck Squads</h1>
        <p className="text-white/50">
          Team up with friends. When anyone in your squad wins, the prize is split — 80% to
          the winner and 20% shared among squad members proportional to their weight.
        </p>
      </div>

      {/* How squads work */}
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        {[
          {
            icon: <Crown className="h-5 w-5 text-amber-400" />,
            title: "Create",
            desc: "Start a squad and become the leader. Share your Squad ID with friends.",
          },
          {
            icon: <Users className="h-5 w-5 text-cyan-400" />,
            title: "Join",
            desc: "Enter a friend's Squad ID to join their group. Max 10 members per squad.",
          },
          {
            icon: <Shield className="h-5 w-5 text-emerald-400" />,
            title: "Win Together",
            desc: "When any member wins, 20% of the prize flows to all squad members by weight.",
          },
        ].map(({ icon, title, desc }) => (
          <div key={title} className="glass-card p-5 flex gap-3">
            <div className="mt-0.5 shrink-0">{icon}</div>
            <div>
              <div className="font-semibold text-white mb-1">{title}</div>
              <div className="text-xs text-white/50">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Success toast */}
      {done !== "none" && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-400">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span className="font-semibold">
            {done === "created" && "Squad created! Share your Squad ID with friends."}
            {done === "joined" && "You've joined the squad!"}
            {done === "left" && "You've left the squad."}
          </span>
          <button
            onClick={() => setDone("none")}
            className="ml-auto text-xs opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Current squad info */}
        <div className="space-y-4">
          {isInSquad && squadInfo ? (
            <div className="glass-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-bold text-white flex items-center gap-2">
                  <Users className="h-5 w-5 text-purple-400" />
                  Your Squad
                </h2>
                <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1">
                  <span className="text-xs text-white/40">ID</span>
                  <span className="font-mono font-bold text-white">{squadId!.toString()}</span>
                  <button
                    onClick={copySquadId}
                    className="text-white/40 hover:text-amber-400 transition-colors"
                    title="Copy Squad ID"
                  >
                    {copied ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Members — squadInfo is a tuple: [leader, members[], active] */}
              {(() => {
                const leader = squadInfo[0];
                const members = squadInfo[1];
                const active = squadInfo[2];
                return (
                  <>
                    <div className="space-y-2">
                      {members.map((member, idx) => {
                        const isLeader = member.toLowerCase() === leader.toLowerCase();
                        const isMe = member.toLowerCase() === address.toLowerCase();
                        return (
                          <div
                            key={member}
                            className={`flex items-center justify-between rounded-xl p-3 text-sm ${
                              isMe ? "bg-amber-400/10 border border-amber-400/20" : "bg-white/5"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 font-mono text-xs text-white/60">
                                {idx + 1}
                              </div>
                              <span className="font-mono text-white/80">
                                {truncateAddress(member)}
                              </span>
                              {isMe && (
                                <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-400">
                                  You
                                </span>
                              )}
                              {isLeader && (
                                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/50 flex items-center gap-1">
                                  <Crown className="h-3 w-3" /> Leader
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-white/30">
                      <span>{members.length} / 10 members</span>
                      <span className={active ? "text-emerald-400" : "text-red-400"}>
                        {active ? "● Active" : "● Inactive"}
                      </span>
                    </div>
                  </>
                );
              })()}

              {/* Leave button */}
              <button
                onClick={handleLeave}
                disabled={isLoading}
                className="btn-secondary mt-5 w-full flex items-center justify-center gap-2 text-red-400 border-red-400/20 hover:bg-red-400/10"
              >
                {action === "leave" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Leaving…
                  </>
                ) : (
                  <>
                    <LogOut className="h-4 w-4" />
                    Leave Squad
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="glass-card p-8 text-center">
              <div className="mb-3 text-5xl">🫂</div>
              <h3 className="mb-2 font-bold text-white">No Squad Yet</h3>
              <p className="text-sm text-white/40">
                Create a new squad or join an existing one to start winning together.
              </p>
            </div>
          )}

          {/* Your weight info */}
          {userInfo && userInfo.principal > 0n && (
            <div className="glass-card p-5 text-sm">
              <h3 className="mb-3 font-semibold text-white/60 text-xs uppercase tracking-widest">
                Your Contribution
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-white/50">Principal</span>
                  <span className="font-bold text-white">
                    ${(Number(userInfo.principal) / 1e6).toFixed(2)} USDC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Weight</span>
                  <span className="font-bold text-white">
                    {(Number(userInfo.weightBps) / 100).toFixed(1)} pts
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Tier</span>
                  <span className="font-bold text-white">
                    {/* BUG-02: derive from tier amounts; show combo for mixed strategy */}
                    {(() => {
                      const parts: string[] = [];
                      if (userInfo.tier1Amount > 0n) parts.push("Worker 🔵");
                      if (userInfo.tier2Amount > 0n) parts.push("Player 🟣");
                      if (userInfo.tier3Amount > 0n) parts.push("VIP 🟠");
                      return parts.length > 0 ? parts.join(" + ") : "—";
                    })()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        {!isInSquad && (
          <div className="space-y-4">
            {/* Create */}
            <div className="glass-card p-6">
              <h3 className="mb-3 flex items-center gap-2 font-bold text-white">
                <Plus className="h-5 w-5 text-amber-400" />
                Create a Squad
              </h3>
              <p className="mb-5 text-sm text-white/50">
                Become a squad leader. Share your Squad ID with friends so they can join.
              </p>
              <button
                onClick={handleCreate}
                disabled={isLoading}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {action === "create" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Create Squad
                  </>
                )}
              </button>
            </div>

            {/* Join */}
            <div className="glass-card p-6">
              <h3 className="mb-3 flex items-center gap-2 font-bold text-white">
                <LogIn className="h-5 w-5 text-cyan-400" />
                Join a Squad
              </h3>
              <p className="mb-4 text-sm text-white/50">
                Enter the Squad ID shared by your friend.
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={joinIdInput}
                  onChange={(e) => { setJoinIdInput(e.target.value); setTxError(""); }}
                  placeholder="Squad ID"
                  className={`input-field ${txError ? "border-red-400/50" : ""}`}
                />
                <button
                  onClick={handleJoin}
                  disabled={isLoading || !joinIdInput}
                  className="btn-primary shrink-0 flex items-center gap-2"
                >
                  {action === "join" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  Join
                </button>
              </div>
              {txError && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {txError}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
