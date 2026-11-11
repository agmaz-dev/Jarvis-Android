// Jarvis: eigene KI auf dem Handy (llama.cpp über JNI)
#include <jni.h>
#include <atomic>
#include <mutex>
#include <string>
#include <vector>
#include <cstring>

#include "llama.h"
#include "chat.h"
#include "common.h"

static llama_model *g_model = nullptr;
static llama_context *g_ctx = nullptr;
static common_chat_templates_ptr g_tmpl;
static std::vector<llama_token> g_cache;   // was gerade im KV-Speicher steht (für schnelle Folgefragen)
static std::atomic<bool> g_stop{false};
static std::mutex g_mu;
static std::string g_err;

static void free_all() {
    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    g_tmpl.reset();
    g_cache.clear();
}

static std::string jstr(JNIEnv *env, jstring s) {
    if (!s) return "";
    const char *c = env->GetStringUTFChars(s, nullptr);
    std::string r(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return r;
}

// Länge des gültigen UTF-8-Anfangs (unvollständige Zeichen am Ende zurückhalten)
static size_t utf8_valid_prefix(const std::string &s) {
    size_t n = s.size(), i = n;
    int back = 0;
    while (i > 0 && back < 4) {
        unsigned char c = (unsigned char) s[i - 1];
        if ((c & 0xC0) == 0x80) { i--; back++; continue; }
        int need = (c & 0x80) == 0 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 1;
        return (back + 1 >= need) ? n : i - 1;
    }
    return n;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_de_agmaz_jarvis_Llm_nativeLoad(JNIEnv *env, jclass, jstring jpath, jint nCtx, jint nThreads) {
    std::lock_guard<std::mutex> lk(g_mu);
    free_all();
    g_err.clear();
    static bool backend = false;
    if (!backend) { llama_backend_init(); backend = true; }
    std::string path = jstr(env, jpath);
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    g_model = llama_model_load_from_file(path.c_str(), mp);
    if (!g_model) { g_err = "Modell konnte nicht geladen werden (Datei defekt oder zu wenig Arbeitsspeicher)."; return JNI_FALSE; }
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = nCtx > 0 ? nCtx : 4096;
    cp.n_batch = 512;
    cp.n_ubatch = 512;
    cp.n_threads = nThreads > 0 ? nThreads : 6;
    cp.n_threads_batch = cp.n_threads;
    cp.swa_full = true;   // damit der Gesprächsanfang wiederverwendet werden kann
    cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_AUTO;
    cp.type_k = GGML_TYPE_Q8_0;
    cp.type_v = GGML_TYPE_Q8_0;
    g_ctx = llama_init_from_model(g_model, cp);
    if (!g_ctx) {
        // zweiter Versuch ohne komprimierten KV-Speicher
        cp.type_k = GGML_TYPE_F16; cp.type_v = GGML_TYPE_F16; cp.n_ctx = 2048;
        g_ctx = llama_init_from_model(g_model, cp);
    }
    if (!g_ctx) { g_err = "Zu wenig Arbeitsspeicher für dieses Modell."; free_all(); return JNI_FALSE; }
    try {
        g_tmpl = common_chat_templates_init(g_model, "");
    } catch (...) {
        g_tmpl.reset();
    }
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_de_agmaz_jarvis_Llm_nativeError(JNIEnv *env, jclass) {
    return env->NewStringUTF(g_err.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_de_agmaz_jarvis_Llm_nativeStop(JNIEnv *, jclass) { g_stop = true; }

extern "C" JNIEXPORT void JNICALL
Java_de_agmaz_jarvis_Llm_nativeUnload(JNIEnv *, jclass) {
    g_stop = true;
    std::lock_guard<std::mutex> lk(g_mu);
    free_all();
}

// roles/contents: parallele Arrays; cb.onToken(byte[]) wird für jedes Textstück aufgerufen
extern "C" JNIEXPORT jstring JNICALL
Java_de_agmaz_jarvis_Llm_nativeGenerate(JNIEnv *env, jclass, jobjectArray roles, jobjectArray contents,
                                        jint maxTokens, jfloat temp, jobject cb) {
    std::lock_guard<std::mutex> lk(g_mu);
    g_stop = false;
    if (!g_model || !g_ctx) return env->NewStringUTF("Kein Modell geladen.");
    jclass cbc = env->GetObjectClass(cb);
    jmethodID onTok = env->GetMethodID(cbc, "onToken", "([B)V");
    const llama_vocab *vocab = llama_model_get_vocab(g_model);

    // 1) Chat-Vorlage des Modells anwenden
    std::vector<common_chat_msg> msgs;
    jsize n = env->GetArrayLength(roles);
    for (jsize i = 0; i < n; i++) {
        common_chat_msg m;
        m.role = jstr(env, (jstring) env->GetObjectArrayElement(roles, i));
        m.content = jstr(env, (jstring) env->GetObjectArrayElement(contents, i));
        msgs.push_back(m);
    }
    std::vector<llama_token> toks;
    bool templ_ok = false;
    if (g_tmpl) {
        try {
            common_chat_templates_inputs in;
            in.messages = msgs;
            in.add_generation_prompt = true;
            in.use_jinja = true;
            in.enable_thinking = false;
            common_chat_params p = common_chat_templates_apply(g_tmpl.get(), in);
            bool first = true;
            for (const auto &part : p.prompt.parts) {
                auto t = common_tokenize(vocab, part.text, first && llama_vocab_get_add_bos(vocab), !part.is_input);
                toks.insert(toks.end(), t.begin(), t.end());
                first = false;
            }
            templ_ok = true;
        } catch (...) { toks.clear(); }
    }
    if (!templ_ok) {
        // Notlösung: Gemma-Format von Hand
        std::string s;
        std::string sys;
        for (auto &m : msgs) {
            if (m.role == "system") { sys += m.content + "\n\n"; continue; }
            std::string role = m.role == "assistant" ? "model" : "user";
            std::string c = m.content;
            if (role == "user" && !sys.empty()) { c = sys + c; sys.clear(); }
            s += "<start_of_turn>" + role + "\n" + c + "<end_of_turn>\n";
        }
        s += "<start_of_turn>model\n";
        toks = common_tokenize(vocab, s, true, true);
    }
    int n_ctx = (int) llama_n_ctx(g_ctx);
    int budget = n_ctx - (maxTokens > 0 ? maxTokens : 700) - 8;
    if ((int) toks.size() > budget) return env->NewStringUTF("Die Unterhaltung ist zu lang für das Modell. Bitte einen neuen Chat beginnen.");

    // 2) Gemeinsamen Anfang mit dem letzten Mal wiederverwenden
    llama_memory_t mem = llama_get_memory(g_ctx);
    size_t keep = 0;
    while (keep < g_cache.size() && keep < toks.size() && g_cache[keep] == toks[keep]) keep++;
    if (keep == toks.size() && keep > 0) keep--;
    if (keep < g_cache.size()) {
        if (!llama_memory_seq_rm(mem, 0, (llama_pos) keep, -1)) {
            llama_memory_clear(mem, true);
            keep = 0;
        }
    }
    g_cache.resize(keep);

    // 3) Neue Eingabe verarbeiten
    int nb = (int) llama_n_batch(g_ctx);
    for (size_t i = keep; i < toks.size(); i += nb) {
        if (g_stop) return env->NewStringUTF("");
        int cnt = (int) std::min((size_t) nb, toks.size() - i);
        llama_batch b = llama_batch_get_one(toks.data() + i, cnt);
        if (llama_decode(g_ctx, b) != 0) {
            llama_memory_clear(mem, true);
            g_cache.clear();
            return env->NewStringUTF("Fehler beim Verarbeiten der Eingabe (zu wenig Speicher?).");
        }
        g_cache.insert(g_cache.end(), toks.begin() + i, toks.begin() + i + cnt);
    }

    // 4) Antwort erzeugen
    llama_sampler *smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    llama_sampler_chain_add(smpl, llama_sampler_init_top_k(64));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.95f, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(temp > 0 ? temp : 0.8f));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    std::string pending;
    int limit = maxTokens > 0 ? maxTokens : 700;
    for (int i = 0; i < limit && !g_stop; i++) {
        llama_token t = llama_sampler_sample(smpl, g_ctx, -1);
        if (llama_vocab_is_eog(vocab, t)) break;
        char buf[256];
        int len = llama_token_to_piece(vocab, t, buf, sizeof(buf), 0, false);
        if (len > 0) pending.append(buf, len);
        size_t ok = utf8_valid_prefix(pending);
        if (ok > 0) {
            jbyteArray arr = env->NewByteArray((jsize) ok);
            env->SetByteArrayRegion(arr, 0, (jsize) ok, (const jbyte *) pending.data());
            env->CallVoidMethod(cb, onTok, arr);
            env->DeleteLocalRef(arr);
            pending.erase(0, ok);
        }
        llama_batch b = llama_batch_get_one(&t, 1);
        if (llama_decode(g_ctx, b) != 0) break;
        g_cache.push_back(t);
        if ((int) g_cache.size() >= n_ctx - 2) break;
    }
    llama_sampler_free(smpl);
    return env->NewStringUTF("");
}
