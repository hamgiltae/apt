import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  Plus,
  X,
  Trash2,
  Loader2,
  Pencil,
  Sparkles,
  RotateCcw,
  Check,
  ArrowLeft,
  Image as ImageIcon,
  Settings,
} from "lucide-react";

const uid = () => Math.random().toString(36).slice(2, 10);
const API_KEY_STORAGE = "anthropic_api_key";
const MODEL = "claude-sonnet-5"; // change here if Anthropic renames/updates the model string

const FORMAT_RULE =
  "\n\n[형식 규칙] 대사(말)는 그냥 평문으로 쓰고, 행동·표정·상황 묘사나 속마음은 반드시 *별표로 감싸서* 쓰세요. 예: *창밖을 잠시 바라보다가* 오랜만이네. *살짝 웃으며* 여긴 어떻게 왔어? 장면 전환이나 상황 설명만 필요할 때는 대사 없이 전체를 지문(별표 없이 자연스러운 서술체)으로 써도 됩니다. 사용자가 이전에 말한 설정과 사건을 절대 잊지 말고 일관성을 유지하세요.";

const DEFAULT_CHARACTER = {
  id: "default",
  name: "루카",
  avatar: null,
  createdAt: 1,
  persona:
    "당신은 '루카'라는 이름의 신비로운 서점 주인입니다. 낡은 서재를 배경으로, 손님(사용자)과 함께 즉흥적인 이야기를 만들어갑니다. 말투는 차분하고 시적이며, 사용자가 이야기를 이끌어가도록 여지를 남깁니다." +
    FORMAT_RULE,
  greeting: "*낡은 책장 사이에서 먼지를 털며 돌아본다* 어서 와요. 오늘은 어떤 이야기를 찾고 있나요?",
};

// ---- localStorage helpers (personal, per-browser) ----
function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}
function lsDelete(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    // ignore
  }
}

// Splits text into alternating speech / narration segments based on *asterisk* convention.
function parseSegments(text) {
  const regex = /\*([^*]+)\*/g;
  const segments = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      if (plain.trim()) segments.push({ type: "speech", text: plain.trim() });
    }
    if (match[1].trim()) segments.push({ type: "narration", text: match[1].trim() });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex);
    if (rest.trim()) segments.push({ type: "speech", text: rest.trim() });
  }
  return segments.length ? segments : [{ type: "speech", text }];
}

function resizeImageFile(file, maxDim = 480, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("파일을 읽을 수 없어요."));
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("이미지를 불러올 수 없어요."));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function apiHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

async function callClaudeText(historyMsgs, persona, apiKey) {
  const apiMessages = historyMsgs.map((m) => ({ role: m.role, content: m.content }));
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: apiHeaders(apiKey),
    body: JSON.stringify({ model: MODEL, max_tokens: 1000, system: persona, messages: apiMessages }),
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error((errBody && errBody.error && errBody.error.message) || `요청 실패 (${response.status})`);
  }
  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return textBlock ? textBlock.text : "(응답을 받지 못했어요.)";
}

async function generateCharacterFromImage(dataUrl, description, refDataUrl, apiKey) {
  const commaIdx = dataUrl.indexOf(",");
  const mediaType = dataUrl.slice(5, dataUrl.indexOf(";"));
  const base64Data = dataUrl.slice(commaIdx + 1);
  const systemPrompt =
    '이미지와 설명을 바탕으로 롤플레잉 채팅 캐릭터를 설계하는 도우미입니다. 첫 번째 이미지는 캐릭터의 외형이고, 두 번째 이미지(있는 경우)는 캐릭터의 설정·세계관·성격을 유추할 수 있는 참고 자료(스크린샷, 텍스트, 다른 장면 등)이니 참고 이미지에서 읽을 수 있는 정보는 최대한 반영하세요. 반드시 아래 JSON 형식으로만 응답하고, JSON 외의 어떤 텍스트나 코드블록 표시도 포함하지 마세요.\n' +
    '{"name": "캐릭터 이름", "greeting": "캐릭터가 대화를 먼저 시작할 때 건네는 첫 대사. 행동/속마음은 *별표*로 감싸기", "persona": "캐릭터의 성격, 배경, 세계관, 말투를 3인칭 시점에서 상세히 서술한 지침. 대사는 평문으로 쓰고 행동·표정·속마음·장면 묘사는 반드시 *별표로 감싸서* 표현하도록 캐릭터에게 지시하는 문장을 반드시 포함할 것."}';
  const userText = description && description.trim()
    ? `이 이미지 속 캐릭터를 만들어줘. 참고 설명: ${description.trim()}`
    : "이 이미지를 보고 어울리는 캐릭터를 만들어줘.";
  const content = [{ type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } }];
  if (refDataUrl) {
    const refComma = refDataUrl.indexOf(",");
    const refMediaType = refDataUrl.slice(5, refDataUrl.indexOf(";"));
    const refBase64 = refDataUrl.slice(refComma + 1);
    content.push({ type: "image", source: { type: "base64", media_type: refMediaType, data: refBase64 } });
  }
  content.push({ type: "text", text: userText });
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: apiHeaders(apiKey),
    body: JSON.stringify({ model: MODEL, max_tokens: 1000, system: systemPrompt, messages: [{ role: "user", content }] }),
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error((errBody && errBody.error && errBody.error.message) || `요청 실패 (${response.status})`);
  }
  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  const raw = textBlock ? textBlock.text : "";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

function Avatar({ character, size = 48 }) {
  if (character.avatar) {
    return (
      <img
        src={character.avatar}
        alt={character.name}
        style={{ width: size, height: size, objectFit: "cover" }}
        className="rounded-full flex-shrink-0"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, background: "#232833", color: "#C98A3E", fontFamily: "'Spectral', serif", fontSize: size * 0.4 }}
      className="rounded-full flex-shrink-0 flex items-center justify-center"
    >
      {character.name ? character.name[0] : "?"}
    </div>
  );
}

function MessageActions({ onEdit, onRegenerate, onUndo, center }) {
  return (
    <div className={`flex gap-1 mt-1 ${center ? "justify-center" : "justify-start"}`}>
      <button onClick={onEdit} title="직접 수정" className="p-1.5 rounded-full" style={{ background: "#1B1F26", color: "#8B8F98" }}>
        <Pencil size={13} />
      </button>
      <button onClick={onRegenerate} title="다시 생성" className="p-1.5 rounded-full" style={{ background: "#1B1F26", color: "#8B8F98" }}>
        <Sparkles size={13} />
      </button>
      <button onClick={onUndo} title="되돌리기" className="p-1.5 rounded-full" style={{ background: "#1B1F26", color: "#8B8F98" }}>
        <RotateCcw size={13} />
      </button>
    </div>
  );
}

export default function App() {
  const [characters, setCharacters] = useState([DEFAULT_CHARACTER]);
  const [activeId, setActiveId] = useState(null);
  const [messagesByChar, setMessagesByChar] = useState({});
  const [view, setView] = useState("home");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createTab, setCreateTab] = useState("ai");
  const [error, setError] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState("");

  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");

  const [imgPreview, setImgPreview] = useState(null);
  const [refImgPreview, setRefImgPreview] = useState(null);
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [manualName, setManualName] = useState("");
  const [manualPersona, setManualPersona] = useState("");

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const refFileInputRef = useRef(null);

  useEffect(() => {
    const storedKey = lsGet(API_KEY_STORAGE);
    if (storedKey) setApiKey(storedKey);
    else setShowSettings(true);

    const raw = lsGet("characters");
    const list = raw ? JSON.parse(raw) : null;
    if (list && list.length) {
      setCharacters(list);
      list.forEach((c) => loadMessagesFor(c.id));
    } else {
      lsSet("characters", JSON.stringify([DEFAULT_CHARACTER]));
      loadMessagesFor(DEFAULT_CHARACTER.id);
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messagesByChar, activeId, loading, view]);

  const loadMessagesFor = (charId) => {
    const raw = lsGet(`messages:${charId}`);
    const msgs = raw ? JSON.parse(raw) : [];
    setMessagesByChar((prev) => ({ ...prev, [charId]: msgs }));
  };

  const persistCharacters = (list) => {
    setCharacters(list);
    lsSet("characters", JSON.stringify(list));
  };

  const persistMessages = (charId, msgs) => {
    setMessagesByChar((prev) => ({ ...prev, [charId]: msgs }));
    lsSet(`messages:${charId}`, JSON.stringify(msgs));
  };

  const saveApiKey = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    lsSet(API_KEY_STORAGE, trimmed);
    setApiKey(trimmed);
    setApiKeyInput("");
    setShowSettings(false);
  };

  const clearApiKey = () => {
    lsDelete(API_KEY_STORAGE);
    setApiKey("");
  };

  const activeCharacter = characters.find((c) => c.id === activeId) || null;
  const currentMessages = (activeId && messagesByChar[activeId]) || [];

  const requireKey = () => {
    if (!apiKey) {
      setShowSettings(true);
      return false;
    }
    return true;
  };

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !activeCharacter) return;
    if (!requireKey()) return;
    setError(null);
    const userMsg = { role: "user", content: text, ts: Date.now() };
    const nextMsgs = [...currentMessages, userMsg];
    setInput("");
    persistMessages(activeId, nextMsgs);
    setLoading(true);
    try {
      const replyText = await callClaudeText(nextMsgs, activeCharacter.persona, apiKey);
      const assistantMsg = { role: "assistant", content: replyText, ts: Date.now() };
      persistMessages(activeId, [...nextMsgs, assistantMsg]);
    } catch (e) {
      setError(e.message || "응답을 받아오는 데 실패했어요.");
    } finally {
      setLoading(false);
    }
  }, [input, loading, currentMessages, activeId, activeCharacter, apiKey]);

  const handleRegenerate = useCallback(
    async (index) => {
      if (loading || !activeCharacter) return;
      if (!requireKey()) return;
      const history = currentMessages.slice(0, index);
      setError(null);
      setLoading(true);
      try {
        const replyText = await callClaudeText(history, activeCharacter.persona, apiKey);
        const assistantMsg = { role: "assistant", content: replyText, ts: Date.now() };
        persistMessages(activeId, [...history, assistantMsg]);
      } catch (e) {
        setError(e.message || "다시 생성하는 데 실패했어요.");
      } finally {
        setLoading(false);
      }
    },
    [loading, currentMessages, activeId, activeCharacter, apiKey]
  );

  const handleUndo = useCallback(
    (index) => {
      if (loading) return;
      const priorUser = currentMessages[index - 1];
      const history = currentMessages.slice(0, Math.max(index - 1, 0));
      persistMessages(activeId, history);
      if (priorUser && priorUser.role === "user") setInput(priorUser.content);
    },
    [loading, currentMessages, activeId]
  );

  const startEdit = (index) => {
    setEditingIndex(index);
    setEditText(currentMessages[index].content);
  };

  const saveEdit = (index) => {
    const updated = currentMessages.map((m, i) => (i === index ? { ...m, content: editText } : m));
    persistMessages(activeId, updated);
    setEditingIndex(null);
    setEditText("");
  };

  const insertAsterisk = () => {
    const ta = textareaRef.current;
    if (!ta) {
      setInput((v) => v + "**");
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = input.slice(start, end);
    const inserted = selected ? `*${selected}*` : "**";
    const nextVal = input.slice(0, start) + inserted + input.slice(end);
    setInput(nextVal);
    requestAnimationFrame(() => {
      ta.focus();
      const cursor = selected ? start + inserted.length : start + 1;
      ta.setSelectionRange(cursor, cursor);
    });
  };

  const openCharacter = (id) => {
    setActiveId(id);
    setView("chat");
    setEditingIndex(null);
    setInput("");
    setError(null);
  };

  const resetCreateForm = () => {
    setImgPreview(null);
    setRefImgPreview(null);
    setDescription("");
    setCreateError(null);
    setManualName("");
    setManualPersona("");
    setCreateTab("ai");
  };

  const handleImagePick = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setCreateError(null);
    try {
      setImgPreview(await resizeImageFile(file));
    } catch (err) {
      setCreateError("이미지를 읽는 데 실패했어요.");
    }
  };

  const handleRefImagePick = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setCreateError(null);
    try {
      setRefImgPreview(await resizeImageFile(file, 900, 0.8));
    } catch (err) {
      setCreateError("참고 이미지를 읽는 데 실패했어요.");
    }
  };

  const handleAiCreate = async () => {
    if (!imgPreview) {
      setCreateError("먼저 사진을 올려주세요.");
      return;
    }
    if (!requireKey()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await generateCharacterFromImage(imgPreview, description, refImgPreview, apiKey);
      const persona = (result.persona || "") + FORMAT_RULE;
      const char = { id: uid(), name: result.name || "새 캐릭터", avatar: imgPreview, persona, greeting: result.greeting || "", createdAt: Date.now() };
      const list = [char, ...characters];
      persistCharacters(list);
      persistMessages(char.id, char.greeting ? [{ role: "assistant", content: char.greeting, ts: Date.now() }] : []);
      setShowCreate(false);
      resetCreateForm();
    } catch (err) {
      setCreateError(err.message || "캐릭터 분석에 실패했어요. 사진을 바꾸거나 설명을 조금 더 적어서 다시 시도해 보세요.");
    } finally {
      setCreating(false);
    }
  };

  const handleManualCreate = () => {
    if (!manualName.trim() || !manualPersona.trim()) return;
    const char = { id: uid(), name: manualName.trim(), avatar: null, persona: manualPersona.trim() + FORMAT_RULE, greeting: "", createdAt: Date.now() };
    const list = [char, ...characters];
    persistCharacters(list);
    persistMessages(char.id, []);
    setShowCreate(false);
    resetCreateForm();
  };

  const handleDeleteCharacter = (id, e) => {
    e.stopPropagation();
    if (characters.length <= 1) return;
    const list = characters.filter((c) => c.id !== id);
    persistCharacters(list);
    lsDelete(`messages:${id}`);
    if (activeId === id) {
      setActiveId(null);
      setView("home");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const lastActivityOf = (c) => {
    const msgs = messagesByChar[c.id];
    if (msgs && msgs.length) return msgs[msgs.length - 1].ts || 0;
    return c.createdAt || 0;
  };
  const sortedCharacters = [...characters].sort((a, b) => lastActivityOf(b) - lastActivityOf(a));
  const previewOf = (c) => {
    const msgs = messagesByChar[c.id];
    const last = msgs && msgs.length ? msgs[msgs.length - 1].content : c.greeting;
    if (!last) return "새로운 이야기를 시작해보세요.";
    return last.length > 46 ? last.slice(0, 46) + "…" : last;
  };

  return (
    <div style={{ background: "#12151A", fontFamily: "'Inter', sans-serif" }} className="w-full h-screen flex text-[#ECE6D6] overflow-hidden relative">
      {view === "home" && (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
            <div style={{ fontFamily: "'Spectral', serif" }} className="text-2xl">대화</div>
            <button onClick={() => setShowSettings(true)} style={{ color: "#8B8F98" }}>
              <Settings size={20} />
            </button>
          </div>

          <div className="px-5 pb-2 flex-shrink-0">
            <div className="text-xs mb-3" style={{ color: "#8B8F98" }}>내 캐릭터</div>
            <div className="flex gap-4 overflow-x-auto pb-1">
              <button onClick={() => { resetCreateForm(); setShowCreate(true); }} className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <div className="rounded-full flex items-center justify-center" style={{ width: 56, height: 56, border: "1.5px dashed #3A4048", color: "#C98A3E" }}>
                  <Plus size={20} />
                </div>
                <span className="text-[11px]" style={{ color: "#8B8F98" }}>새로 만들기</span>
              </button>
              {characters.map((c) => (
                <button key={c.id} onClick={() => openCharacter(c.id)} className="flex flex-col items-center gap-1.5 flex-shrink-0 max-w-[64px]">
                  <Avatar character={c} size={56} />
                  <span className="text-[11px] truncate w-full text-center">{c.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 pt-3 pb-2 text-sm flex-shrink-0" style={{ color: "#8B8F98", borderTop: "1px solid #1F242C" }}>최신순</div>

          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {sortedCharacters.map((c) => (
              <div key={c.id} onClick={() => openCharacter(c.id)} className="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer group">
                <Avatar character={c} size={52} />
                <div className="min-w-0 flex-1">
                  <div style={{ fontFamily: "'Spectral', serif" }} className="text-[15px] truncate">{c.name}</div>
                  <div className="text-[13px] truncate mt-0.5" style={{ color: "#8B8F98" }}>{previewOf(c)}</div>
                </div>
                {characters.length > 1 && (
                  <button onClick={(e) => handleDeleteCharacter(c.id, e)} className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-2" style={{ color: "#8B8F98" }}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "chat" && activeCharacter && (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ borderBottom: "1px solid #2A2F38", background: "#14171D" }}>
            <button onClick={() => setView("home")} style={{ color: "#8B8F98" }}><ArrowLeft size={20} /></button>
            <Avatar character={activeCharacter} size={30} />
            <div style={{ fontFamily: "'Spectral', serif" }} className="text-base">{activeCharacter.name}</div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
            {currentMessages.length === 0 && (
              <div className="text-center text-sm mt-10" style={{ color: "#8B8F98" }}>{activeCharacter.name}에게 첫 마디를 건네보세요.</div>
            )}
            {currentMessages.map((m, i) => {
              const isLastAssistant = m.role === "assistant" && i === currentMessages.length - 1 && !loading;
              const segments = editingIndex === i ? null : parseSegments(m.content);
              const isPureNarration = segments && segments.length > 0 && segments.every((s) => s.type === "narration");

              if (editingIndex === i) {
                return (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[85%] w-full">
                      <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} autoFocus
                        className="w-full rounded-lg px-3 py-2 text-[15px] outline-none resize-none"
                        style={{ background: "#1B1F26", color: "#ECE6D6", border: "1px solid #C98A3E" }} />
                      <div className="flex gap-2 justify-end mt-1.5">
                        <button onClick={() => setEditingIndex(null)} className="text-xs px-2 py-1" style={{ color: "#8B8F98" }}>취소</button>
                        <button onClick={() => saveEdit(i)} className="text-xs px-2.5 py-1 rounded flex items-center gap-1" style={{ background: "#C98A3E", color: "#12151A" }}>
                          <Check size={12} /> 저장
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              if (isPureNarration) {
                return (
                  <div key={i} className="px-2 py-1">
                    <div className="text-[14px] leading-relaxed italic text-center whitespace-pre-wrap" style={{ color: "#8B8F98", opacity: 0.75 }}>
                      {segments[0].text}
                    </div>
                    {isLastAssistant && <MessageActions onEdit={() => startEdit(i)} onRegenerate={() => handleRegenerate(i)} onUndo={() => handleUndo(i)} center />}
                  </div>
                );
              }

              return (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[80%]">
                    <div className="px-4 py-2.5 rounded-lg text-[15px] leading-relaxed whitespace-pre-wrap"
                      style={m.role === "user" ? { background: "#232833", color: "#ECE6D6" } : { background: "#1B1F26", color: "#ECE6D6", borderLeft: "2px solid #C98A3E" }}>
                      {segments.map((s, si) =>
                        s.type === "narration" ? (
                          <span key={si} style={{ opacity: 0.55, fontStyle: "italic" }}>{si > 0 ? " " : ""}{s.text}</span>
                        ) : (
                          <span key={si}>{si > 0 ? " " : ""}{s.text}</span>
                        )
                      )}
                    </div>
                    {isLastAssistant && <MessageActions onEdit={() => startEdit(i)} onRegenerate={() => handleRegenerate(i)} onUndo={() => handleUndo(i)} />}
                  </div>
                </div>
              );
            })}
            {loading && (
              <div className="flex justify-start">
                <div className="px-4 py-2.5 rounded-lg text-sm flex items-center gap-2" style={{ background: "#1B1F26", borderLeft: "2px solid #C98A3E", color: "#8B8F98" }}>
                  <Loader2 className="animate-spin" size={14} /> 이야기를 잇는 중...
                </div>
              </div>
            )}
          </div>

          {error && <div className="px-4 py-2 text-xs" style={{ color: "#D08D6E" }}>{error}</div>}

          <div className="flex-shrink-0 p-3 flex gap-2 items-end" style={{ borderTop: "1px solid #2A2F38", background: "#14171D" }}>
            <button onClick={insertAsterisk} title="행동/속마음 표시 (*텍스트*)" className="flex-shrink-0 rounded-full w-9 h-9 flex items-center justify-center text-[17px]"
              style={{ background: "#1B1F26", color: "#C98A3E", border: "1px solid #2A2F38" }}>*</button>
            <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="이야기를 이어가 보세요... (*행동/속마음*)" rows={1}
              className="flex-1 resize-none rounded-md px-3 py-2.5 text-[15px] outline-none"
              style={{ background: "#1B1F26", color: "#ECE6D6", border: "1px solid #2A2F38", maxHeight: 120 }} />
            <button onClick={handleSend} disabled={loading || !input.trim()} className="rounded-md p-2.5 flex-shrink-0 disabled:opacity-40"
              style={{ background: "#C98A3E", color: "#12151A" }}>
              <Send size={18} />
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 z-30 flex items-center justify-center px-4">
          <div className="w-full max-w-sm rounded-lg p-5 max-h-[90vh] overflow-y-auto" style={{ background: "#181C22", border: "1px solid #2A2F38" }}>
            <div className="flex items-center justify-between mb-4">
              <div style={{ fontFamily: "'Spectral', serif" }} className="text-lg">새 캐릭터</div>
              <button onClick={() => setShowCreate(false)} style={{ color: "#8B8F98" }}><X size={18} /></button>
            </div>

            <div className="flex mb-4 rounded-md overflow-hidden" style={{ border: "1px solid #2A2F38" }}>
              <button onClick={() => setCreateTab("ai")} className="flex-1 py-2 text-sm"
                style={{ background: createTab === "ai" ? "#C98A3E" : "transparent", color: createTab === "ai" ? "#12151A" : "#ECE6D6" }}>AI로 만들기</button>
              <button onClick={() => setCreateTab("manual")} className="flex-1 py-2 text-sm"
                style={{ background: createTab === "manual" ? "#C98A3E" : "transparent", color: createTab === "manual" ? "#12151A" : "#ECE6D6" }}>직접 입력</button>
            </div>

            {createTab === "ai" ? (
              <div>
                <input ref={fileInputRef} id="char-avatar-input" type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
                <label htmlFor="char-avatar-input" className="w-full rounded-md flex flex-col items-center justify-center gap-2 mb-3 cursor-pointer"
                  style={{ background: "#1B1F26", border: "1px dashed #3A4048", height: imgPreview ? "auto" : 140, padding: imgPreview ? 8 : 0 }}>
                  {imgPreview ? <img src={imgPreview} alt="미리보기" className="rounded-md max-h-52 object-contain" /> : (
                    <>
                      <ImageIcon size={22} color="#8B8F98" />
                      <span className="text-xs" style={{ color: "#8B8F98" }}>캐릭터 사진 올리기</span>
                    </>
                  )}
                </label>

                <label className="text-xs" style={{ color: "#8B8F98" }}>설명 (선택)</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                  className="w-full mt-1 mb-3 rounded-md px-3 py-2 text-sm outline-none resize-none"
                  style={{ background: "#1B1F26", color: "#ECE6D6", border: "1px solid #2A2F38" }}
                  placeholder="성격, 말투, 세계관 등을 적어주면 더 정확하게 만들어져요." />

                <input ref={refFileInputRef} id="char-ref-input" type="file" accept="image/*" onChange={handleRefImagePick} className="hidden" />
                <label htmlFor="char-ref-input" className="text-xs" style={{ color: "#8B8F98" }}>설정 참고 이미지 (선택)</label>
                <div className="text-[11px] mb-1.5" style={{ color: "#6D7178" }}>캐릭터 설정이 담긴 스크린샷이나 그림을 올리면 내용을 읽어서 반영해요. 아바타로는 쓰이지 않아요.</div>
                <label htmlFor="char-ref-input" className="w-full rounded-md flex flex-col items-center justify-center gap-2 mb-3 cursor-pointer"
                  style={{ background: "#1B1F26", border: "1px dashed #3A4048", height: refImgPreview ? "auto" : 96, padding: refImgPreview ? 8 : 0 }}>
                  {refImgPreview ? <img src={refImgPreview} alt="참고 이미지 미리보기" className="rounded-md max-h-40 object-contain" /> : (
                    <>
                      <ImageIcon size={18} color="#8B8F98" />
                      <span className="text-xs" style={{ color: "#8B8F98" }}>참고 이미지 올리기</span>
                    </>
                  )}
                </label>
                {refImgPreview && <button onClick={() => setRefImgPreview(null)} className="text-xs mb-3 -mt-2" style={{ color: "#8B8F98" }}>참고 이미지 제거</button>}

                {createError && <div className="text-xs mb-3" style={{ color: "#D08D6E" }}>{createError}</div>}
                <button onClick={handleAiCreate} disabled={creating || !imgPreview}
                  className="w-full py-2.5 rounded-md text-sm flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ background: "#C98A3E", color: "#12151A" }}>
                  {creating ? (<><Loader2 className="animate-spin" size={15} /> 분석 중...</>) : (<><Sparkles size={15} /> AI로 캐릭터 만들기</>)}
                </button>
              </div>
            ) : (
              <div>
                <label className="text-xs" style={{ color: "#8B8F98" }}>이름</label>
                <input value={manualName} onChange={(e) => setManualName(e.target.value)}
                  className="w-full mt-1 mb-3 rounded-md px-3 py-2 text-sm outline-none"
                  style={{ background: "#1B1F26", color: "#ECE6D6", border: "1px solid #2A2F38" }} placeholder="예: 엘리엇" />
                <label className="text-xs" style={{ color: "#8B8F98" }}>설정 / 성격 / 세계관</label>
                <textarea value={manualPersona} onChange={(e) => setManualPersona(e.target.value)} rows={5}
                  className="w-full mt-1 mb-4 rounded-md px-3 py-2 text-sm outline-none resize-none"
                  style={{ background: "#1B1F26", color: "#ECE6D6", border: "1px solid #2A2F38" }}
                  placeholder="캐릭터의 성격, 배경, 말투를 자세히 적을수록 좋아요." />
                <button onClick={handleManualCreate} className="w-full py-2.5 rounded-md text-sm" style={{ background: "#C98A3E", color: "#12151A" }}>만들기</button>
              </div>
            )}
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center px-4">
          <div className="w-full max-w-sm rounded-lg p-5" style={{ background: "#181C22", border: "1px solid #2A2F38" }}>
            <div className="flex items-center justify-between mb-4">
              <div style={{ fontFamily: "'Spectral', serif" }} className="text-lg">API 키 설정</div>
              {apiKey && <button onClick={() => setShowSettings(false)} style={{ color: "#8B8F98" }}><X size={18} /></button>}
            </div>
            <div className="text-xs mb-3 leading-relaxed" style={{ color: "#8B8F98" }}>
              본인 Anthropic API 키를 입력하세요. 이 키는 서버로 전송되지 않고 이 브라우저에만 저장되며, 오직 api.anthropic.com 호출에만 쓰여요.
              키는 <span style={{ color: "#C98A3E" }}>console.anthropic.com</span>에서 발급받을 수 있어요.
            </div>
            {apiKey ? (
              <div className="mb-3 text-xs px-3 py-2 rounded-md" style={{ background: "#1B1F26", color: "#8B8F98" }}>
                저장된 키: sk-ant-••••{apiKey.slice(-4)}
              </div>
            ) : null}
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full mb-3 rounded-md px-3 py-2 text-sm outline-none"
              style={{ background: "#1B1F26", color: "#ECE6D6", border: "1px solid #2A2F38" }}
            />
            <div className="flex gap-2">
              <button onClick={saveApiKey} className="flex-1 py-2.5 rounded-md text-sm" style={{ background: "#C98A3E", color: "#12151A" }}>저장</button>
              {apiKey && <button onClick={clearApiKey} className="px-3 py-2.5 rounded-md text-sm" style={{ color: "#8B8F98", border: "1px solid #2A2F38" }}>삭제</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
