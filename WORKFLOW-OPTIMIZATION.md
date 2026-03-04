ok we need to make sure of these things before wrapping up:


__________________________________________
OPTIMIZE Contract number of tx needed and CRE-workflow execution for phase 1 and phase 2 ( both the test purposed simulation and the actual workflow in the /workflows/ folder) 

In general keep in mind that chainlink workflows has execution limits. Can't do too many https calls, can't last more than x time etc. ( i believe this numbers are somehwere in docs, anyway for now if we do this we are kinda ok as we don't do more than 
1 call to drand, 
1 sent tx
1 upload on pinata 
1 ponder call 

For thsi reason is important that meanwhile you do the following task, you fihgure out a way that ponder can pass all the data in the least possible number of calls ( it should give us for a market all market and submarket info with list of votes of allk the submarkets, not 1 by 1 ) 
rest is basically jsut computation over result 


Because user may be partecipating on more options ( submarkets ) for a given market:

We should set the create function that make cast the vote in batch ( so for example we have a 4 option market ) the user may buy ticket ( if sufficient tickets are available for each of the submarket ) and cast vote for option 1 and option 2 

because dRand encrypted is basically a Field, we cant encrypt a very big value or many of them. 

We still have a validation and critography problem.


Because the Main Market has a round for dRand enc set, for the same values casted, someone could just make a brute force attack to find out exactly all the values regardless of decryption randomness round in the future. Just cause if you encrypt 70/30 % for example you can find everyone that did 70/30 cause you know the value. 
double check how many bit we have to ecnrypt on quicknet 

for example we could just sign a messsage of a given prefixed message

k = keccak256(signature(m), [current unix time at moment of cast with ms precision], submarket( or option)  index ) 

encrypte dvalue should be k % some number to ensure atleast 128 bit so we have space for 1000 bps percentage s 1000 is 1000Yes/0 No  ( for example we set 700, implicitly yes ) means we have 300 NO, no need to repeat the obvious the value should be in the rightmost space we encrypt [k][some 00 i gues][value of yes where 1000 = 100%]
 

for each submarket he wanna partecipate in we will have different k, so we have a batch function that takes 4 different values.
if value is 0, its ofc 0% yes, 100% no. If youy are not casting for a market you just dont actualluy encrypt a different field for it. 

The phase1 workflow at this point just need to gather all the casted votes for all the submarket, he will need to call drand with timelockjs just once to get the random number at the given round so he can decrypt all the values, slice and just get the value he needs to determine Yes ( then calculates the No too ofc easy ) 

Then it will compute the bonus/malus stuff for each market.

the merkle that it builds should be just one merkle, the leaf should have something like  leaf is keccak256(reference to address that can claim the leaf, [Yes/No shares to claim for index 0, for index 1, for index 2 ... ] and so on depending on how many option the market has. 
Its important here we consider both YES/NO togheter, because 0 YES dosent ean necesarely 100% No, could be just empty, cause in thsi phase the h/reference agent addres, sharesYes/No[submarket.length].

So on contract the only change is that the workflow will just set all the stuff post-calculus just with 1 tx and 1 merkle as its now. But ofc the process in the workflow is slightly different now


This batch approach of resolving phase2 should be the same for phase2 if not already like dat ( the workflow should make just 1 tx to set all market's submarked resolution outcome ) 


Because this involves updating the Abi Too we should do so, and make sure that everywhere we use cast vote or claim after phase1 or claim burning the shares for the amount the agent can reclaim after phase2 resolution shoud be updated accordingly in ponder indexer 
----------------------

Also the Agents should be after phase2 able to actally just need 1 tx to claim all the submarkets (if an agent has shares of 3 submarket of 4 for example, he will just need 1 tx to claim all of 3. This should emit 3 events so the indexer still see 3 claims ) 



Remember we cant do too many calls we should be under 30 seocnds of runtime to resolve the market i think, double check on docs 


_____________________________

The indexer not being very precise

Another thing that needs to be fixed is the following. I created a market with 3 options actually, first all the script.sh we use to test the e2e ( uselessly ask for pass to confirm labels ) i think this is just redudant tbh. 

Also since my password for the anvil key i saved chack is pass, please instead of havinbg me write "pass" each time i'm asked, automatically pass it so i'm asked only for the relevenant stuff of markets. 
also let me choose during the process the label before the question, and let me choose the total premium ( not for each market but the total the creator will put as 6 decimal usdc 1 = 0.000001$ ) 

also i noticed this problem right now in the indexer. I created a merket with 3 options as i told you 

│ Event                               │ Count │ Duration (ms) │
│ MiniMarket:MarketCreated            │     1 │         1.664 │
│ MiniMarket:SubmarketCreated         │     9 │         0.632 │
│ MiniMarket:Encry...bmissionReceived │     5 │         0.533 │
│ MiniMarket:InfoPhaseRevealed        │     3 │         0.214 │
│ MiniMarket:Phase1Resolved           │     3 │         0.061 │


this is what i see in the terminal i run ponder, as you see the submarket is basically tripled. If i do 4 option i indeed see 12. 

This should be investigated, on teh frontend i still see just 3, so i guess serving the submarket list works fine, but still here i have 9 and sshouldn't be. 

--------------------------------------------------------
