# ChainSpin

ChainSpin is a small experiment in shared rules. A group puts its choices on a board, agrees on which blockchains to use and draws one tile. Someone who kept the original commitment can check the winner independently. ChainSpin runs in the browser and reads public Bitcoin, Ethereum and Solana data. It needs no wallet or new contract.

[Try the board](https://hyperyana.com/projects/onchain-experiments/chain-spin/) · [Hyperyana’s Onchain Experiments](https://hyperyana.com/projects/onchain-experiments/)

## Try a verifiable draw

1. Add or rename the tiles, select the chains and choose when to draw. For a first shared draw, choose **1 minute** to leave time to share the commitment.
2. Select **Start draw** and **Export commitment**. Give the file to the other participants before the target blocks arrive. It fixes the option names and order, timing and starting blocks.
3. After the border stops, select **View receipt** to see the winning tile and the block hashes. A participant can open **History → Import receipt**, load the original commitment and select **Reconstruct draw** to find the same winner.

The protocol combines the selected block inputs with SHA-256 and uses rejection sampling to give each tile equal odds under the uniform-hash assumption. The host still chooses the entries and can start another round. Keeping the commitment lets participants recognize which round they agreed to. The board’s **Protocol** tab explains block selection and how chain reorganizations affect verification.

## Run locally

From the repository root, run the command below and open <http://127.0.0.1:8000/>. Live draws need internet access to public nodes.

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

For a draw that behaves unexpectedly, include the selected chains, timing mode and what you observed in a [GitHub issue](https://github.com/Neraz1m/chain-spin/issues/new).

[MIT license](LICENSE)
