import ai.djl.engine.Engine;
import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer;
import java.nio.file.Paths;

/** Build-time native preparation; never runs during container startup. */
public final class PrimeInference {
    public static void main(String[] args) throws Exception {
        Engine engine = Engine.getEngine("PyTorch");
        System.out.println("Packaged CPU tensor helper: " + engine.getEngineName() + " " + engine.getVersion());
        try (HuggingFaceTokenizer tokenizer = HuggingFaceTokenizer.newInstance(Paths.get("/tmp/tokenizer.json"))) {
            System.out.println("Packaged tokenizer: " + tokenizer.encode("Local packaging probe.").getIds().length);
        }
    }
}
